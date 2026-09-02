import type { UIMessage } from "ai"
import { eq } from "drizzle-orm"

// Imported straight from `./client` rather than `@/lib/db`: this module runs
// inside the Trigger.dev worker, where the `server-only` marker on the `@/lib/db`
// entry would throw.
import { db, games } from "@/lib/db/client"

/**
 * A game's stored chat thread.
 *
 * Lookups here are by id alone, with no org scoping, unlike `getGame`. The
 * caller is the chat agent, which has no Clerk session to scope by — a game id
 * only ever reaches it through a session the server actions in
 * `@/lib/games/chat-actions` already authorized against the caller's org.
 */
export async function loadGameMessages(gameId: string): Promise<UIMessage[]> {
  const [game] = await db
    .select({ messages: games.messages })
    .from(games)
    .where(eq(games.id, gameId))
    .limit(1)

  return game?.messages ?? []
}

/**
 * The organization a game belongs to, or `undefined` if the game is gone.
 *
 * The agent bills the org that owns the game rather than one it is told about:
 * the model id on a turn comes from the browser, but who pays for it is settled
 * here, from the row, where a tab cannot reach it.
 */
export async function loadGameOrgId(
  gameId: string
): Promise<string | undefined> {
  const [game] = await db
    .select({ orgId: games.orgId })
    .from(games)
    .where(eq(games.id, gameId))
    .limit(1)

  return game?.orgId
}

/**
 * Replaces a game's chat thread.
 *
 * The thread is stored whole on every turn, so the caller passes the complete
 * message list rather than an append.
 */
export async function saveGameMessages({
  gameId,
  messages,
}: {
  gameId: string
  messages: UIMessage[]
}): Promise<void> {
  await db.update(games).set({ messages }).where(eq(games.id, gameId))
}

/**
 * Replaces a game's chat thread and the stream cursor for it.
 *
 * One statement, so the two can't diverge: a reload landing between separate
 * writes would resume from a cursor that points past messages the row doesn't
 * have yet, and replay the assistant turn on top of itself.
 */
export async function saveGameTurn({
  gameId,
  messages,
  chatAccessToken,
  chatLastEventId,
}: {
  gameId: string
  messages: UIMessage[]
  chatAccessToken: string
  chatLastEventId: string | undefined
}): Promise<void> {
  await db
    .update(games)
    .set({ messages, chatAccessToken, chatLastEventId })
    .where(eq(games.id, gameId))
}
