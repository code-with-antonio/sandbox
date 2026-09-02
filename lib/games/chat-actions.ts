"use server"

import { auth } from "@clerk/nextjs/server"
import * as Sentry from "@sentry/nextjs"
import { auth as triggerAuth } from "@trigger.dev/sdk"
import { chat, type ChatStartSessionParams } from "@trigger.dev/sdk/ai"

import { getGame } from "@/lib/games/queries"
import { describeError, elapsed } from "@/lib/observability"
import type { gameChat } from "@/trigger/chat"

const startSession = chat.createStartSessionAction<typeof gameChat>("game-chat")

/**
 * The check the chat route handler used to run per request. It moves here
 * because these two actions are the only paths that hand the browser a token
 * for a chat session — being signed in is not the same as being entitled to
 * this game's thread, and the id arrives from the browser.
 */
async function authorizeGame(gameId: string, action: string) {
  const { userId, orgId } = await auth()

  // These two rejections are the app's authorization boundary for chat, and a
  // boundary nobody can see is a boundary nobody can tell is holding. Both are
  // warnings rather than errors: a signed-out tab left open produces the first
  // and a stale bookmark the second, so neither is on its own a problem — a
  // run of them from one caller is.
  if (!userId || !orgId) {
    Sentry.logger.warn(
      Sentry.logger.fmt`Rejected unauthenticated ${action} for game ${gameId}`,
      {
        "app.action": action,
        "game.id": gameId,
        "auth.has_user": Boolean(userId),
        "auth.has_organization": Boolean(orgId),
      }
    )

    throw new Error("Unauthorized")
  }

  // Also the ownership check — `getGame` only resolves games belonging to the
  // caller's active organization.
  if (!(await getGame(gameId))) {
    Sentry.logger.warn(
      Sentry.logger
        .fmt`Rejected ${action} for game ${gameId} the caller cannot see`,
      {
        "app.action": action,
        "game.id": gameId,
        "user.id": userId,
        "organization.id": orgId,
      }
    )

    throw new Error("Not Found")
  }

  // Tags rather than scope attributes, and for events rather than logs:
  // attributes set on a scope never reach logs, and the logs in this file name
  // the game explicitly anyway. What this buys is that a throw from the Trigger
  // handover below arrives already saying which game and caller it was.
  //
  // Per-request rather than global, so one caller's identity cannot leak into
  // a concurrent request's events.
  Sentry.getIsolationScope().setTags({
    "app.action": action,
    "game.id": gameId,
    "user.id": userId,
    "organization.id": orgId,
  })
}

/**
 * Creates the chat session and triggers its first run, then returns a
 * session-scoped token. Idempotent on (environment, chatId), so two tabs
 * converge on one session.
 */
export async function startGameChatSession(
  params: ChatStartSessionParams<typeof gameChat>
) {
  const startedAt = performance.now()

  await authorizeGame(params.chatId, "startGameChatSession")

  try {
    const session = await startSession(params)

    // The handover from the web app to the Trigger.dev worker. Logged on both
    // sides — `trigger/chat.ts` records the turn this starts — so a thread that
    // never streams can be placed on one side of the boundary or the other.
    Sentry.logger.info(
      Sentry.logger.fmt`Started chat session for game ${params.chatId}`,
      { "game.id": params.chatId, duration_ms: elapsed(startedAt) }
    )

    return session
  } catch (error) {
    // Idempotent on (environment, chatId), so this is not a second tab losing
    // a race — it is the session genuinely failing to start, which leaves the
    // player with a composer that does nothing.
    Sentry.logger.error(
      Sentry.logger.fmt`Could not start chat session for game ${params.chatId}`,
      {
        "game.id": params.chatId,
        ...describeError(error),
        duration_ms: elapsed(startedAt),
      }
    )

    throw error
  }
}

/**
 * Pure mint — the transport calls this on a 401/403 to refresh an expired
 * token. Runs on the server, so `TRIGGER_SECRET_KEY` never reaches the browser.
 */
export async function mintGameChatAccessToken(chatId: string) {
  await authorizeGame(chatId, "mintGameChatAccessToken")

  // The transport only calls this after a 401/403, so each one is a token that
  // expired mid-thread. Ordinary once an hour; a burst of them means tokens are
  // being rejected long before they expire.
  Sentry.logger.debug(
    Sentry.logger.fmt`Minted a chat access token for game ${chatId}`,
    { "game.id": chatId }
  )

  return triggerAuth.createPublicToken({
    scopes: {
      read: { sessions: chatId },
      write: { sessions: chatId },
    },
    expirationTime: "1h",
  })
}
