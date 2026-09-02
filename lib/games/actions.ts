"use server"

import { anthropic } from "@ai-sdk/anthropic"
import { auth } from "@clerk/nextjs/server"
import * as Sentry from "@sentry/nextjs"
import { generateText } from "ai"
import { and, eq } from "drizzle-orm"
import { refresh } from "next/cache"
import { redirect } from "next/navigation"

import { deleteGameSandboxes } from "@/lib/daytona/utils"
import { db, games } from "@/lib/db"
import { authorizeGame } from "@/lib/games/authorize"
import { endGameChatSession } from "@/lib/games/chat-session"
import { generateMessageId } from "@/lib/games/messages"
import {
  DEFAULT_GAME_MODEL_ID,
  type GameModelId,
  isGameModelId,
} from "@/lib/games/model-catalog"
import { truncateTitle } from "@/lib/games/title"
import { describeError, elapsed } from "@/lib/observability"

const TITLE_MODEL = "claude-haiku-4-5"

/**
 * Names a game after the prompt it was created from.
 *
 * This runs before the composer can navigate anywhere, so it uses the cheapest,
 * fastest model available and falls back to the raw prompt if the model is slow,
 * unavailable, or returns nothing usable — a game with an awkward title beats a
 * create that fails.
 */
async function generateTitle(prompt: string) {
  const startedAt = performance.now()

  try {
    const { text } = await generateText({
      model: anthropic(TITLE_MODEL),
      instructions:
        "You name games from the prompt that created them. Reply with a title " +
        "of at most four words in title case. No quotes, no punctuation at the " +
        "end, no explanation — the title only.",
      prompt,
      maxOutputTokens: 32,
    })

    // Models like to wrap a bare title in quotes even when told not to.
    const title = text.trim().replace(/^["'“”]+|["'“”]+$/g, "")

    if (!title) {
      // The call came back, so this is the model answering with nothing rather
      // than the model being unreachable — a different failure from the catch
      // below, and one only a log would ever show.
      Sentry.logger.warn("Title model returned nothing usable", {
        "gen_ai.operation.name": "generate_content",
        "gen_ai.request.model": TITLE_MODEL,
        duration_ms: elapsed(startedAt),
      })
    }

    return title || truncateTitle(prompt)
  } catch (error) {
    // Swallowed on purpose — an awkward title beats a failed create — but
    // swallowed silently this is invisible, and a title model that is down
    // looks from the outside like a product that stopped naming games.
    Sentry.logger.warn("Title generation failed, falling back to the prompt", {
      "gen_ai.operation.name": "generate_content",
      "gen_ai.request.model": TITLE_MODEL,
      ...describeError(error),
      duration_ms: elapsed(startedAt),
    })

    return truncateTitle(prompt)
  }
}

/**
 * Creates a game from the composer prompt, scopes it to the caller's active
 * organization, and navigates to it.
 *
 * The prompt is stored as the thread's opening message so it survives the
 * navigation without riding along in the URL; `ChatThread` asks for the reply
 * once the game page mounts. The model picked alongside it does ride in the
 * URL — see the redirect below.
 *
 * Server Actions are reachable by direct POST, so the org is resolved from the
 * session here rather than trusted from the caller.
 */
export async function createGame(prompt: string, modelId: GameModelId) {
  const startedAt = performance.now()
  const { userId, orgId } = await auth()

  if (!orgId) {
    // Reachable by direct POST, per the note above, so this is as much a
    // security signal as a bug report: a caller with no active org asking for
    // a game is either a broken client or someone probing the action.
    Sentry.logger.warn("Rejected createGame with no active organization", {
      "user.id": userId ?? "anonymous",
      "app.action": "createGame",
    })

    throw new Error("An active organization is required to create a game.")
  }

  // Tags, not scope attributes: attributes reach spans and events but not logs,
  // and these are here for the *events* — so that a throw further down (the
  // insert, the redirect) arrives in Sentry already saying whose create it was.
  // The logs below carry the same identity explicitly.
  //
  // Per-request, not global: the isolation scope is unique to this action call,
  // so these can't bleed into another user's concurrent request.
  Sentry.getIsolationScope().setTags({
    "app.action": "createGame",
    "user.id": userId ?? "unknown",
    "organization.id": orgId,
  })

  const trimmedPrompt = typeof prompt === "string" ? prompt.trim() : ""

  if (!trimmedPrompt) {
    return
  }

  // Checked rather than trusted, for the same reason the org is: this action is
  // reachable by direct POST, and the value goes straight into the URL below.
  const model = isGameModelId(modelId) ? modelId : DEFAULT_GAME_MODEL_ID

  const [game] = await db
    .insert(games)
    .values({
      orgId,
      title: truncateTitle(await generateTitle(trimmedPrompt)),
      messages: [
        {
          id: generateMessageId(),
          role: "user",
          parts: [{ type: "text", text: trimmedPrompt }],
        },
      ],
    })
    .returning({ id: games.id })

  // The funnel's first step, and the one every other signal here hangs off. The
  // prompt itself is not logged — only its length: prompts are kept out of
  // Sentry deliberately (see `httpBodies: []` in the SDK configs), and the
  // length is what answers the question a log can answer anyway, which is
  // whether people are typing a sentence or a design document.
  Sentry.logger.info(Sentry.logger.fmt`Created game ${game.id}`, {
    "app.action": "createGame",
    "game.id": game.id,
    "user.id": userId ?? "unknown",
    "organization.id": orgId,
    "prompt.length": trimmedPrompt.length,
    // Which model the game is about to be built with — the one question about
    // a create that only a picker makes it possible to ask.
    "game.model": model,
    duration_ms: elapsed(startedAt),
  })

  // The redirect below stays inside `app/(app)/layout.tsx`, so invalidate the
  // router cache rather than let the sidebar render the games list it already
  // has — the new game is missing from it.
  refresh()

  // The model rides along in the query string, which is the whole of how the
  // home page's pick reaches the thread: it belongs to this navigation rather
  // than to the game, so there is nothing on the row to keep it in, and the
  // thread is free to change it from there. The default is left off — the game
  // page falls back to it — so the ordinary URL stays `/games/{id}`.
  //
  // `redirect` throws, so nothing may follow it here.
  redirect(
    model === DEFAULT_GAME_MODEL_ID
      ? `/games/${game.id}`
      : `/games/${game.id}?model=${model}`
  )
}

/**
 * Renames a game.
 *
 * The title is the game's only editable field, and the same length cap the
 * generated ones get applies here — the sidebar and the game header both render
 * it in one line, and neither is a place to discover that a title was pasted
 * from a document.
 *
 * A blank or unchanged title is a no-op rather than an error: the dialog will
 * not submit one, so reaching this is either a direct POST or a double submit,
 * and neither wants a failure it can act on.
 */
export async function renameGame(gameId: string, title: string) {
  const { game, orgId } = await authorizeGame(gameId, "renameGame")

  const trimmed = typeof title === "string" ? truncateTitle(title.trim()) : ""

  if (!trimmed || trimmed === game.title) {
    return
  }

  // Scoped to the org as well as the id, even though `authorizeGame` has
  // already proved ownership: it costs an indexed comparison and makes the
  // statement safe to read on its own.
  await db
    .update(games)
    .set({ title: trimmed })
    .where(and(eq(games.id, gameId), eq(games.orgId, orgId)))

  // The title itself is not logged, for the same reason prompts are not:
  // it is the player's words. The length is what a log would want anyway —
  // whether people are naming games or writing sentences in the box.
  Sentry.logger.info(Sentry.logger.fmt`Renamed game ${gameId}`, {
    "app.action": "renameGame",
    "game.id": gameId,
    "organization.id": orgId,
    "title.length": trimmed.length,
  })

  // The header on the game page and the sidebar's list are both server-rendered
  // from the row, so this is what puts the new name on screen.
  refresh()
}

/**
 * Deletes a game, everything Daytona is holding for it, and its chat session,
 * then returns to the home page.
 *
 * The order is the whole of this function, and it is chosen so that no step can
 * leave a sandbox running that nothing will ever come back for:
 *
 *  1. End the chat session, so no turn is mid-flight when the row goes and
 *     none can start after it.
 *  2. Delete the sandboxes. This is the step allowed to fail the whole action:
 *     it throws, the row survives, and the player can try again — a game they
 *     can still see is the only handle a retry has.
 *  3. Delete the row. From here on nothing can make another sandbox for this
 *     game: `getGameSandbox` reads the row first and throws without one.
 *  4. Sweep once more. A tool that read the row just before step 3 could have
 *     created a sandbox after step 2 looked; the sweep is by label, so it finds
 *     that one too. Failing here is only logged — the game is already gone, so
 *     there is nothing left for the player to retry.
 *
 * `returnHome` is the caller saying whether the page it is on belongs to the
 * game it just deleted. The menu is in the sidebar as well as the game header,
 * so a delete is as likely to be aimed at a game nobody is looking at — and
 * moving that person to the home page would be a navigation they did not ask
 * for. The destination is fixed here, so a caller only chooses between leaving
 * and staying.
 */
export async function deleteGame(gameId: string, returnHome: boolean) {
  const startedAt = performance.now()
  const { game, userId, orgId } = await authorizeGame(gameId, "deleteGame")

  await endGameChatSession(gameId)

  const sandboxes = await deleteGameSandboxes(gameId, game.sandboxId)

  await db
    .delete(games)
    .where(and(eq(games.id, gameId), eq(games.orgId, orgId)))

  try {
    await deleteGameSandboxes(gameId)
  } catch (error) {
    // Deliberately not rethrown, per the note above. The label search in
    // `deleteGameSandboxes` is what an operator would run by hand to clean this
    // up, and it has already logged the id of every sandbox that would not go.
    Sentry.logger.error(
      Sentry.logger
        .fmt`Could not sweep sandboxes after deleting game ${gameId}`,
      {
        "app.action": "deleteGame",
        "game.id": gameId,
        "organization.id": orgId,
        ...describeError(error),
      }
    )
  }

  // The end of the funnel that starts with the create log above, and the only
  // record that this game existed once the row is gone — which is why it
  // carries the sandbox count rather than leaving that to the Daytona log.
  Sentry.logger.info(Sentry.logger.fmt`Deleted game ${gameId}`, {
    "app.action": "deleteGame",
    "game.id": gameId,
    "user.id": userId,
    "organization.id": orgId,
    "sandbox.deleted": sandboxes,
    duration_ms: elapsed(startedAt),
  })

  // The sidebar lists this game on every page of the app, so wherever the
  // delete came from, what is on screen now is stale.
  refresh()

  // And when what is on screen is the deleted game's own page, the refresh
  // above is what would turn it into a 404 — so leaving is not a courtesy here
  // but the rest of the delete.
  //
  // `redirect` throws, so nothing may follow it here.
  if (returnHome) {
    redirect("/")
  }
}
