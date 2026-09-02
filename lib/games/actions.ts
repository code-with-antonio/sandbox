"use server"

import { anthropic } from "@ai-sdk/anthropic"
import { auth } from "@clerk/nextjs/server"
import * as Sentry from "@sentry/nextjs"
import { generateText } from "ai"
import { refresh } from "next/cache"
import { redirect } from "next/navigation"

import { db, games } from "@/lib/db"
import { generateMessageId } from "@/lib/games/messages"
import { describeError, elapsed } from "@/lib/observability"

const TITLE_MODEL = "claude-haiku-4-5"

const TITLE_MAX_LENGTH = 80

function truncate(title: string) {
  return title.length > TITLE_MAX_LENGTH
    ? `${title.slice(0, TITLE_MAX_LENGTH - 1).trimEnd()}…`
    : title
}

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

    return title || truncate(prompt)
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

    return truncate(prompt)
  }
}

/**
 * Creates a game from the composer prompt, scopes it to the caller's active
 * organization, and navigates to it.
 *
 * The prompt is stored as the thread's opening message so it survives the
 * navigation without riding along in the URL; `ChatThread` asks for the reply
 * once the game page mounts.
 *
 * Server Actions are reachable by direct POST, so the org is resolved from the
 * session here rather than trusted from the caller.
 */
export async function createGame(prompt: string) {
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

  const [game] = await db
    .insert(games)
    .values({
      orgId,
      title: truncate(await generateTitle(trimmedPrompt)),
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
    duration_ms: elapsed(startedAt),
  })

  // The redirect below stays inside `app/(app)/layout.tsx`, so invalidate the
  // router cache rather than let the sidebar render the games list it already
  // has — the new game is missing from it.
  refresh()

  // `redirect` throws, so nothing may follow it here.
  redirect(`/games/${game.id}`)
}
