import "server-only"

import { createIdGenerator, type UIMessage } from "ai"
import { and, eq } from "drizzle-orm"

import { db, games } from "@/lib/db"

// Ids for messages that are persisted without ever passing through the
// client: the opening prompt a game is created with, and the assistant
// replies the chat route streams back.
export const generateMessageId = createIdGenerator({ prefix: "msg", size: 16 })

/**
 * Replaces a game's chat thread with `messages`.
 *
 * The thread is stored whole on every turn, so the caller passes the complete
 * message list rather than an append. `orgId` is passed in rather than read
 * from the session because this runs from a stream callback, which may outlive
 * the request context.
 */
export async function saveGameMessages({
  gameId,
  orgId,
  messages,
}: {
  gameId: string
  orgId: string
  messages: UIMessage[]
}): Promise<void> {
  await db
    .update(games)
    .set({ messages })
    .where(and(eq(games.id, gameId), eq(games.orgId, orgId)))
}
