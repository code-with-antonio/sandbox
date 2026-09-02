import type { Sandbox } from "@daytona/sdk"
import { eq } from "drizzle-orm"

import { daytona } from "@/lib/daytona/client"
// Imported straight from `./client` rather than `@/lib/db`, like the chat
// store: this module runs inside the Trigger.dev worker, where the
// `server-only` marker on the `@/lib/db` entry would throw.
import { db, games } from "@/lib/db/client"
import { readRuntimeFiles } from "@/lib/games/seed"
import { describeError, elapsed, logger } from "@/lib/observability"

// Where the game's source lives inside the sandbox. `/home/daytona` is the
// sandbox user's home, so this is the path a dev server would be pointed at.
// Exported because the agent is told this path in `@/lib/games/instructions` —
// the prompt and the server have to be pointed at the same directory.
export const GAME_DIR = "/home/daytona/game"

/**
 * Creates the Daytona sandbox a game is built in and records it on the game.
 *
 * The sandbox starts seeded with the files in `@/lib/games/runtime`, one of
 * which is a placeholder page, so the game has something servable from its
 * very first moment, before the agent has written any code.
 *
 * The sandbox id is saved last: a row with a `sandboxId` therefore always names
 * a sandbox that exists and is seeded, and a crash in between leaks an unused
 * sandbox rather than pointing the game at a half-built one.
 */
export async function createGameSandbox(
  gameId: string
): Promise<{ sandbox: Sandbox }> {
  const startedAt = performance.now()
  const { folders, files } = await readRuntimeFiles(GAME_DIR)

  const sandbox = await daytona.create({ labels: { gameId } })

  await sandbox.fs.createFolder(GAME_DIR, "755")

  for (const folder of folders) {
    await sandbox.fs.createFolder(folder, "755")
  }

  // One request for the whole tree rather than one per file, so seeding costs
  // the same round trip whether `runtime/` holds one file or twenty.
  await sandbox.fs.uploadFiles(files)

  await db
    .update(games)
    .set({ sandboxId: sandbox.id })
    .where(eq(games.id, gameId))

  // The one place a sandbox comes into existence, and the slowest step in a
  // game's first turn — a create that has crept from seconds to a minute is
  // visible here and nowhere else, which is why the duration is on it.
  logger.info(logger.fmt`Created sandbox for game ${gameId}`, {
    "game.id": gameId,
    "sandbox.id": sandbox.id,
    "sandbox.seed_files": files.length,
    "sandbox.seed_folders": folders.length,
    duration_ms: elapsed(startedAt),
  })

  return { sandbox }
}

/**
 * Deletes every Daytona sandbox belonging to a game, and reports how many went.
 *
 * Sandboxes are found by the `gameId` label `createGameSandbox` puts on them
 * rather than by the id on the row, because the row is not a complete record of
 * them: the id is written last, so a crash in between leaves a sandbox that is
 * running and labelled and that nothing points at. A delete has to take those
 * with it — a sandbox nobody can reach still bills. `sandboxId` is passed in
 * as well for the opposite case, a row naming a sandbox the label search
 * misses, and is skipped when the search already found it.
 *
 * Every sandbox is attempted before anything throws, so one that refuses to go
 * cannot strand the rest. That it throws at all is what lets the caller keep
 * the game row on failure: the row is the only handle a retry has.
 */
export async function deleteGameSandboxes(
  gameId: string,
  sandboxId?: string | null
): Promise<number> {
  const startedAt = performance.now()
  const sandboxes = new Map<string, Sandbox>()

  for await (const sandbox of daytona.list({ labels: { gameId } })) {
    sandboxes.set(sandbox.id, sandbox)
  }

  if (sandboxId && !sandboxes.has(sandboxId)) {
    try {
      sandboxes.set(sandboxId, await daytona.get(sandboxId))
    } catch (error) {
      // Almost always a sandbox that is already gone, which is nothing to
      // delete and no reason to fail — but it is also the only signal that a
      // row and Daytona disagree, so it is a warning rather than a swallow.
      logger.warn(
        logger.fmt`Could not fetch sandbox ${sandboxId} of game ${gameId} to delete it`,
        { "game.id": gameId, "sandbox.id": sandboxId, ...describeError(error) }
      )
    }
  }

  const failed: string[] = []
  let deleted = 0

  for (const sandbox of sandboxes.values()) {
    // Already on its way out. Asking again would only produce an error to
    // swallow, and swallowing it would hide the ones that matter.
    if (sandbox.state === "destroyed" || sandbox.state === "destroying") {
      continue
    }

    try {
      await daytona.delete(sandbox)
      deleted += 1
    } catch (error) {
      failed.push(sandbox.id)

      // Per sandbox rather than only in the throw below, because the throw
      // reaches the player as "try again" and this is the half an operator
      // needs: which sandbox, in what state, and what Daytona said about it.
      logger.error(
        logger.fmt`Could not delete sandbox ${sandbox.id} of game ${gameId}`,
        {
          "game.id": gameId,
          "sandbox.id": sandbox.id,
          "sandbox.state": String(sandbox.state),
          ...describeError(error),
        }
      )
    }
  }

  if (failed.length > 0) {
    throw new Error(
      `Could not delete ${failed.length} of ${sandboxes.size} sandboxes for game ${gameId}`
    )
  }

  // The counterpart to the create log, and the only place a delete is visible:
  // more than one sandbox here means the leak described above happened and was
  // cleaned up, which is worth being able to count.
  logger.info(logger.fmt`Deleted ${deleted} sandboxes for game ${gameId}`, {
    "game.id": gameId,
    "sandbox.deleted": deleted,
    "sandbox.found": sandboxes.size,
    duration_ms: elapsed(startedAt),
  })

  return deleted
}

/**
 * The game's sandbox, created if it has none and started if it was stopped.
 *
 * Every tool the agent calls needs a running sandbox and none of them should
 * have to care why one might be missing, so this is the single entry point:
 * a tool asks for the game's sandbox and either gets a usable one or an error.
 *
 * `onChatStart` already creates the sandbox before the first turn streams, so
 * the create path here is a fallback — it covers games that predate sandboxes
 * and a first turn whose creation crashed. Sandboxes also stop themselves once
 * idle, which is the common case for a thread resumed after a while.
 */
export async function getGameSandbox(
  gameId: string
): Promise<{ sandbox: Sandbox }> {
  const [game] = await db
    .select({ sandboxId: games.sandboxId })
    .from(games)
    .where(eq(games.id, gameId))
    .limit(1)

  if (!game) {
    // A tool call naming a game that isn't there means the session outlived
    // its row, which no ordinary path produces — worth a line of its own
    // before the throw, since the throw only says which id was missing.
    logger.error(logger.fmt`No game ${gameId} to get a sandbox for`, {
      "game.id": gameId,
    })

    throw new Error(`No game ${gameId} to get a sandbox for`)
  }

  if (!game.sandboxId) {
    // The fallback path described above. It is meant to be rare, so it is a
    // warning rather than an info: a run of these means `onChatStart` is
    // failing and every first turn is paying the create cost mid-stream.
    logger.warn(
      logger.fmt`Game ${gameId} had no sandbox at tool time, creating one`,
      { "game.id": gameId }
    )

    return createGameSandbox(gameId)
  }

  const sandbox = await daytona.get(game.sandboxId)

  if (sandbox.state !== "started") {
    const startedAt = performance.now()

    await sandbox.start()

    // The resumed-thread case. Ordinary, but it is seconds the player waits
    // through before the agent's first tool call lands, so it is worth being
    // able to see how often it happens and what it costs.
    logger.info(logger.fmt`Restarted idle sandbox for game ${gameId}`, {
      "game.id": gameId,
      "sandbox.id": game.sandboxId,
      "sandbox.previous_state": String(sandbox.state),
      duration_ms: elapsed(startedAt),
    })
  }

  return { sandbox }
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
  const startedAt = performance.now()
  const sandbox = await daytona.get(sandboxId)

  // Sandboxes stop themselves once idle, and a stopped one serves nothing.
  const wasStopped = sandbox.state !== "started"

  if (wasStopped) {
    await sandbox.start()
  }

  const alreadyServing = await serverResponds(sandbox)

  if (!alreadyServing) {
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
      const output = log.result.trim() || "no output"

      // The server's own stderr, which the exception below also carries — but
      // as a log it is searchable across sandboxes, which is how a systemic
      // failure (a base image without python3, a port taken by something else)
      // reads as one thing rather than as scattered 500s.
      logger.error(
        logger.fmt`Game server failed to start in sandbox ${sandboxId}`,
        {
          "sandbox.id": sandboxId,
          "sandbox.was_stopped": wasStopped,
          "server.log": output,
          duration_ms: elapsed(startedAt),
        }
      )

      throw new Error(
        `Game server failed to start in sandbox ${sandboxId}: ${output}`
      )
    }
  }

  // One line per preview load, carrying the two facts that explain how long it
  // took: whether the sandbox had to be woken, and whether a server was already
  // on the port. A cold load pays both and takes seconds; a warm one is a
  // health check and a signature.
  logger.info(logger.fmt`Game server ready in sandbox ${sandboxId}`, {
    "sandbox.id": sandboxId,
    "sandbox.was_stopped": wasStopped,
    "server.reused": alreadyServing,
    duration_ms: elapsed(startedAt),
  })

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
