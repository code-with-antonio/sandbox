"use server"

import { auth } from "@clerk/nextjs/server"
import { refresh } from "next/cache"

import { db, games } from "@/lib/db"

const TITLE_MAX_LENGTH = 80

/**
 * Creates a game from the composer prompt and scopes it to the caller's active
 * organization.
 *
 * Server Actions are reachable by direct POST, so the org is resolved from the
 * session here rather than trusted from the form payload.
 */
export async function createGame(formData: FormData) {
  const { orgId } = await auth()

  if (!orgId) {
    throw new Error("An active organization is required to create a game.")
  }

  const prompt = formData.get("prompt")
  const title = typeof prompt === "string" ? prompt.trim() : ""

  if (!title) {
    return
  }

  await db.insert(games).values({
    orgId,
    title:
      title.length > TITLE_MAX_LENGTH
        ? `${title.slice(0, TITLE_MAX_LENGTH - 1).trimEnd()}…`
        : title,
  })

  // Re-render the server components for the current route — the sidebar reads
  // its games from `app/(app)/layout.tsx`.
  refresh()
}
