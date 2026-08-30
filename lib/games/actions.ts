"use server"

import { anthropic } from "@ai-sdk/anthropic"
import { auth } from "@clerk/nextjs/server"
import { generateText } from "ai"
import { refresh } from "next/cache"

import { db, games } from "@/lib/db"

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
 * Creates a game from the composer prompt and scopes it to the caller's active
 * organization.
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

  await db.insert(games).values({
    orgId,
    title: truncate(await generateTitle(trimmedPrompt)),
  })

  // Re-render the server components for the current route — the sidebar reads
  // its games from `app/(app)/layout.tsx`.
  refresh()
}
