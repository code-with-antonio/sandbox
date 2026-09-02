"use server"

import * as Sentry from "@sentry/nextjs"
import { auth as triggerAuth } from "@trigger.dev/sdk"
import { chat, type ChatStartSessionParams } from "@trigger.dev/sdk/ai"

import { hasCreditsToBuild, OUT_OF_CREDITS } from "@/lib/billing/ledger"
import { authorizeGame } from "@/lib/games/authorize"
import { describeError, elapsed } from "@/lib/observability"
import type { gameChat } from "@/trigger/chat"

const startSession = chat.createStartSessionAction<typeof gameChat>("game-chat")

/**
 * Creates the chat session and triggers its first run, then returns a
 * session-scoped token. Idempotent on (environment, chatId), so two tabs
 * converge on one session.
 */
export async function startGameChatSession(
  params: ChatStartSessionParams<typeof gameChat>
) {
  const startedAt = performance.now()

  const { orgId } = await authorizeGame(params.chatId, "startGameChatSession")

  // Checked before the session exists rather than inside it: a session that
  // cannot afford a turn should never be created, because creating one starts a
  // run that sits there waiting for a message it will only refuse. The agent
  // checks again on every turn after this — a thread outlives the balance that
  // opened it.
  if (!(await hasCreditsToBuild(orgId))) {
    Sentry.logger.info(
      Sentry.logger
        .fmt`Refused a chat session for game ${params.chatId} — no credits`,
      { "game.id": params.chatId, "organization.id": orgId }
    )

    throw new Error(OUT_OF_CREDITS)
  }

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
