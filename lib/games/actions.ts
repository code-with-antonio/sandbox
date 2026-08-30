"use server"

import { anthropic } from "@ai-sdk/anthropic"
import { auth } from "@clerk/nextjs/server"
import { generateText } from "ai"
import { refresh } from "next/cache"
import { redirect } from "next/navigation"

import { db, games } from "@/lib/db"
import { generateMessageId } from "@/lib/games/messages"

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
  try {
    const { text } = await generateText({
      model: anthropic("claude-haiku-4-5"),
      instructions:
        "You name games from the prompt that created them. Reply with a title " +
        "of at most four words in title case. No quotes, no punctuation at the " +
        "end, no explanation — the title only.",
      prompt,
      maxOutputTokens: 32,
    })

    // Models like to wrap a bare title in quotes even when told not to.
    const title = text.trim().replace(/^["'“”]+|["'“”]+$/g, "")

    return title || truncate(prompt)
  } catch {
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
  const { orgId } = await auth()

  if (!orgId) {
    throw new Error("An active organization is required to create a game.")
  }

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

  // The redirect below stays inside `app/(app)/layout.tsx`, so invalidate the
  // router cache rather than let the sidebar render the games list it already
  // has — the new game is missing from it.
  refresh()

  // `redirect` throws, so nothing may follow it here.
  redirect(`/games/${game.id}`)
}
