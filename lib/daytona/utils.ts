import type { Sandbox } from "@daytona/sdk"
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

// The port the game's static server listens on inside the sandbox. Nothing
// else in the sandbox uses it; it just has to be a value the server and the
// preview link agree on — hence exported, for whoever mints that link.
export const PREVIEW_PORT = 3000

// Daytona signs preview urls for 60 seconds by default, which would expire
// under a preview left open in a tab. An hour is their recommendation.
export const PREVIEW_URL_TTL_SECONDS = 3600

// Where the server's own output goes, so a failed start has something to
// report beyond "it isn't answering".
const SERVER_LOG = "/tmp/game-server.log"

// Roughly ten seconds of grace, spent inside the sandbox rather than in
// round-trips from here.
const START_RETRIES = 10

/**
 * Starts (or reuses) the static server for a game's sandbox, and hands back the
 * running sandbox for the caller to mint a preview url from.
 *
 * Idempotent by design — this runs on every preview load. A health check comes
 * first, and only a port with nothing on it gets a new server: a second
 * `http.server` on the same port would exit on "address already in use" and
 * take the log with it, so spawning blindly would be both wasteful and
 * misleading.
 */
export async function startGameServer(
  sandboxId: string
): Promise<{ sandbox: Sandbox }> {
  const sandbox = await daytona.get(sandboxId)

  // Sandboxes stop themselves once idle, and a stopped one serves nothing.
  if (sandbox.state !== "started") {
    await sandbox.start()
  }

  if (!(await serverResponds(sandbox))) {
    // `nohup … &` hands the server off to init and closes the pipes the exec
    // is waiting on, so this returns instead of blocking for the server's
    // lifetime. The log is where to look when a preview comes back empty.
    await sandbox.process.executeCommand(
      `nohup python3 -m http.server ${PREVIEW_PORT} --directory ${GAME_DIR} > ${SERVER_LOG} 2>&1 &`
    )

    // Binding the port takes a moment longer than spawning does, and a url
    // handed back before then loads as a connection error in the iframe.
    if (!(await serverResponds(sandbox, START_RETRIES))) {
      const log = await sandbox.process.executeCommand(`cat ${SERVER_LOG}`)

      throw new Error(
        `Game server failed to start in sandbox ${sandboxId}: ${log.result.trim() || "no output"}`
      )
    }
  }

  return { sandbox }
}

/**
 * Whether something is already answering HTTP on the preview port.
 *
 * `retries` is curl's own retry loop, which keeps the waiting on the sandbox
 * side — one exec that returns when the server is up, rather than a poll that
 * pays a round-trip per attempt. `--retry-connrefused` is what makes it treat
 * a port nothing has bound yet as worth retrying.
 */
async function serverResponds(sandbox: Sandbox, retries = 0): Promise<boolean> {
  const { exitCode } = await sandbox.process.executeCommand(
    `curl -fsS -o /dev/null --max-time 2 --retry ${retries} --retry-connrefused --retry-delay 1 http://localhost:${PREVIEW_PORT}/`
  )

  return exitCode === 0
}
