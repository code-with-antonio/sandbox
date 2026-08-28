import "server-only"

import { auth } from "@clerk/nextjs/server"
import { desc, eq } from "drizzle-orm"

import { db, games, type Game } from "@/lib/db"

/**
 * Games belonging to the caller's active organization, newest first.
 */
export async function listGames(): Promise<Game[]> {
  const { orgId } = await auth()

  // Every game is owned by an org, so without an active one there is nothing
  // this caller is allowed to see.
  if (!orgId) {
    return []
  }

  return db
    .select()
    .from(games)
    .where(eq(games.orgId, orgId))
    .orderBy(desc(games.createdAt))
}
