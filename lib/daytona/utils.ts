import { eq } from "drizzle-orm"

import { daytona } from "@/lib/daytona/client"
// Imported straight from `./client` rather than `@/lib/db`, like the chat
// store: this module runs inside the Trigger.dev worker, where the
// `server-only` marker on the `@/lib/db` entry would throw.
import { db, games } from "@/lib/db/client"

// Where the game's source lives inside the sandbox. `/home/daytona` is the
// sandbox user's home, so this is the path a dev server would be pointed at.
const GAME_DIR = "/home/daytona/game"

/**
 * Creates the Daytona sandbox a game is built in and records it on the game.
 *
 * The sandbox starts with a placeholder `index.html` so the game has something
 * servable from its very first moment, before the agent has written any code.
 *
 * The sandbox id is saved last: a row with a `sandboxId` therefore always names
 * a sandbox that exists and is seeded, and a crash in between leaks an unused
 * sandbox rather than pointing the game at a half-built one.
 */
export async function createGameSandbox(gameId: string): Promise<string> {
  const sandbox = await daytona.create({ labels: { gameId } })

  await sandbox.fs.createFolder(GAME_DIR, "755")
  await sandbox.fs.uploadFile(Buffer.from("New game"), `${GAME_DIR}/index.html`)

  await db
    .update(games)
    .set({ sandboxId: sandbox.id })
    .where(eq(games.id, gameId))

  return sandbox.id
}
