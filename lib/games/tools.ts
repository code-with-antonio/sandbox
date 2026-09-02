import path from "node:path"

import type { FileInfo, Sandbox } from "@daytona/sdk"
import { tool } from "ai"
import { z } from "zod"

import { GAME_DIR, getGameSandbox } from "@/lib/daytona/utils"
import { describeError, elapsed, logger } from "@/lib/observability"

// Every path the agent gives is resolved inside this directory, and the game
// directory is the whole of what the agent can touch: it is what the static
// server serves, so nothing outside it can reach the player anyway.
//
// Paths are also restricted to this character set. It covers every filename a
// browser game needs, and it keeps a path safe to interpolate into the one
// shell command below without quoting games.
const SAFE_PATH = /^[a-zA-Z0-9._/-]+$/

// Big enough for any hand-written game file and small enough that a stray
// binary or generated blob can't blow up the turn's context.
const MAX_FILE_BYTES = 128_000

// How deep `list_files` walks. Games are a handful of files next to
// index.html, so this reaches every level one could plausibly have.
const LIST_DEPTH = 5

/**
 * The question the agent puts to the player, answered in the UI.
 *
 * Alone among the tools it has no `execute`. The call ends the turn with its
 * result still pending, the player answers it in the chat, and the next turn
 * resumes from their choice — the run suspends while it waits, so they can
 * take as long as they like. That is also why it needs an `outputSchema`:
 * with no execute function to infer a result from, the schema is the only
 * statement of what an answer looks like.
 *
 * Static, so it is declared once here rather than built per game like the file
 * tools — nothing about it depends on which sandbox the answer lands in.
 */
const askPlayer = tool({
  description:
    "Put one design question to the player and wait for their answer. Use it to settle a part of the game they haven't decided yet — on the opening turn, to work out what the game actually is before writing any of it. One question per call: the turn stops here until they pick, then carries on, so ask the next one after this answer rather than folding several into one.",
  inputSchema: z.object({
    // First in the schema so it is generated first: naming the part of the
    // game up front keeps the options on one axis, so the player picks
    // between comparable answers rather than between whole games.
    dimension: z
      .enum(["loop", "goal", "challenge", "controls", "world", "look", "feel"])
      .describe(
        [
          "The part of the game the question is about. Choose it first, then write a question that stays inside it.",
          "- loop: the action the player repeats — what they are doing second to second.",
          "- goal: what they are playing towards — winning, losing, scoring, progressing.",
          "- challenge: what stands in their way, and how hard it pushes.",
          "- controls: what they press, and how the game answers.",
          "- world: setting, theme, and how the space is laid out.",
          "- look: art direction — style, palette, camera, scale.",
          "- feel: pace, weight, juice and sound.",
        ].join("\n")
      ),
    question: z
      .string()
      .describe(
        "The question, in one sentence and in the player's terms — what the game would be, not how it would be built."
      ),
    options: z
      .array(
        z.object({
          id: z
            .string()
            .describe(
              'A short lowercase identifier for the option, unique within this question, e.g. "twin-stick".'
            ),
          label: z
            .string()
            .describe("The option in a few words, the way a button reads."),
          description: z
            .string()
            .describe(
              "One sentence on what picking this would mean for the game."
            ),
        })
      )
      .min(2)
      .max(4)
      .describe(
        "The answers to choose between. Each one a different game you would be happy to build — no filler option, and nothing that asks them to write the answer themselves."
      ),
  }),
  outputSchema: z.object({
    optionId: z.string().describe("The id of the option the player picked."),
    label: z.string().describe("The label of the option the player picked."),
  }),
})

/**
 * The tools the agent builds a game with: the file tools it edits the game
 * through, and `ask_player` for the questions it puts back to the player.
 *
 * Built per game rather than declared once, because every file call has to
 * land in *this* game's sandbox and the model never sees a game id — the id is
 * closed over here instead of being an argument the model could get wrong.
 *
 * Tools report expected failures — a missing file, a path outside the game
 * directory, an ambiguous edit — as ordinary results, so the model reads what
 * went wrong and fixes it on the next step. Anything else (a sandbox that
 * won't start, a network error) throws and fails the turn.
 */
export function createGameTools(gameId: string) {
  // One sandbox lookup per turn instead of one per call: `getGameSandbox`
  // costs a query and a Daytona round-trip, and a turn is many edits. Only a
  // resolved handle is kept — a failed lookup clears the cache so the next
  // tool call retries rather than replaying the same rejection.
  let pending: Promise<Sandbox> | undefined

  const sandbox = () => {
    pending ??= getGameSandbox(gameId)
      .then(({ sandbox }) => sandbox)
      .catch((error: unknown) => {
        pending = undefined

        // Every tool call in the turn is waiting on this one promise, so a
        // failure here fails the whole turn rather than one edit. It is logged
        // at the point it happens because the rethrow reaches each caller
        // separately and would otherwise read as several unrelated failures.
        logger.error(logger.fmt`Could not get a sandbox for game ${gameId}`, {
          "game.id": gameId,
          ...describeError(error),
        })

        throw error
      })

    return pending
  }

  return {
    read_file: tool({
      description:
        "Read a file from the game directory. Read a file before editing it — what is on disk is what the player is running, including everything written on earlier turns.",
      inputSchema: z.object({
        path: z
          .string()
          .describe(
            'Path relative to the game directory, e.g. "index.html" or "src/player.js".'
          ),
      }),
      execute: ({ path: filePath }) =>
        expected("read_file", gameId, filePath, async () => {
          const target = resolveGamePath(filePath)
          const box = await sandbox()
          const info = await statFile(box, target)

          if (!info) {
            return `No file at ${relative(target)}.`
          }

          if (info.isDir) {
            return `${relative(target)} is a directory. Use list_files to see what is in it.`
          }

          if (info.size > MAX_FILE_BYTES) {
            return `${relative(target)} is ${info.size} bytes, over the ${MAX_FILE_BYTES} byte read limit. Split it into smaller modules.`
          }

          const content = await box.fs.downloadFile(target)

          return content.toString("utf8")
        }),
    }),

    write_file: tool({
      description:
        "Write a file in the game directory, creating it or replacing its contents whole. Missing parent directories are created. Use replace_text instead when changing part of an existing file.",
      inputSchema: z.object({
        path: z
          .string()
          .describe(
            'Path relative to the game directory, e.g. "index.html" or "src/player.js".'
          ),
        content: z
          .string()
          .describe("The complete contents of the file, not a fragment."),
      }),
      execute: ({ path: filePath, content }) =>
        expected("write_file", gameId, filePath, async () => {
          const target = resolveGamePath(filePath)

          if (Buffer.byteLength(content, "utf8") > MAX_FILE_BYTES) {
            return `That content is over the ${MAX_FILE_BYTES} byte write limit. Split the file into smaller modules.`
          }

          const box = await sandbox()
          const directory = path.posix.dirname(target)

          // `uploadFile` won't create the parent, and `createFolder` fails on
          // one that already exists — `mkdir -p` covers both, and the path is
          // known safe to interpolate by `resolveGamePath`.
          if (directory !== GAME_DIR) {
            await box.process.executeCommand(`mkdir -p '${directory}'`)
          }

          await box.fs.uploadFile(Buffer.from(content, "utf8"), target)

          return `Wrote ${relative(target)} (${lineCount(content)} lines).`
        }),
    }),

    replace_text: tool({
      description:
        "Replace an exact snippet of text in a file in the game directory. Prefer this over write_file for changes that touch part of a file, so the rest of the game stays exactly as it is.",
      inputSchema: z.object({
        path: z
          .string()
          .describe("Path to the file, relative to the game directory."),
        find: z
          .string()
          .describe(
            "The exact text to replace, including its indentation and line breaks. Must appear exactly once in the file unless replace_all is true — include the surrounding lines to make a short snippet unique."
          ),
        replace: z
          .string()
          .describe(
            "The text to put in its place. An empty string deletes the snippet."
          ),
        replace_all: z
          .boolean()
          .optional()
          .describe(
            "Replace every occurrence instead of requiring exactly one. Use for renames."
          ),
      }),
      execute: ({ path: filePath, find, replace, replace_all: replaceAll }) =>
        expected("replace_text", gameId, filePath, async () => {
          const target = resolveGamePath(filePath)

          if (find === "") {
            return "find cannot be empty — pass the exact text to replace."
          }

          const box = await sandbox()
          const info = await statFile(box, target)

          if (!info || info.isDir) {
            return `No file at ${relative(target)}.`
          }

          if (info.size > MAX_FILE_BYTES) {
            return `${relative(target)} is ${info.size} bytes, over the ${MAX_FILE_BYTES} byte limit. Split it into smaller modules.`
          }

          const content = (await box.fs.downloadFile(target)).toString("utf8")
          // Splitting on the literal counts occurrences and does the
          // replacement in one pass, with none of `String.replace`'s
          // interpretation of `$&` and friends in the replacement.
          const parts = content.split(find)
          const occurrences = parts.length - 1

          if (occurrences === 0) {
            return `That text isn't in ${relative(target)}. Read the file and copy the snippet exactly, including indentation.`
          }

          if (occurrences > 1 && !replaceAll) {
            return `That text appears ${occurrences} times in ${relative(target)}. Include the surrounding lines to pick one out, or set replace_all to change them all.`
          }

          const updated = replaceAll
            ? parts.join(replace)
            : content.replace(find, () => replace)

          await box.fs.uploadFile(Buffer.from(updated, "utf8"), target)

          return `Replaced ${occurrences === 1 ? "1 occurrence" : `${occurrences} occurrences`} in ${relative(target)}.`
        }),
    }),

    list_files: tool({
      description:
        "List the files in the game directory. Use it at the start of a turn to see what the game is made of before changing it.",
      inputSchema: z.object({
        path: z
          .string()
          .optional()
          .describe(
            "Subdirectory to list, relative to the game directory. Defaults to the whole game directory."
          ),
      }),
      execute: ({ path: filePath }) =>
        expected("list_files", gameId, filePath, async () => {
          const target = resolveGamePath(filePath ?? ".", { allowRoot: true })
          const box = await sandbox()

          if (target !== GAME_DIR && !(await statFile(box, target))) {
            return `No directory at ${relative(target)}.`
          }

          const entries = await box.fs.listFiles(target, { depth: LIST_DEPTH })
          const files = entries
            .filter((entry) => !entry.isDir)
            // `path` is only guaranteed on a deep listing; a flat one gives
            // names that have to be joined back onto the directory.
            .map((entry) => ({
              path: relative(entry.path ?? path.posix.join(target, entry.name)),
              size: entry.size,
            }))
            .sort((a, b) => a.path.localeCompare(b.path))

          if (files.length === 0) {
            return target === GAME_DIR
              ? "The game directory is empty."
              : `${relative(target)} has no files in it.`
          }

          return files
            .map((file) => `${file.path} (${file.size} bytes)`)
            .join("\n")
        }),
    }),

    delete_file: tool({
      description:
        "Delete a file or directory from the game directory. Only for files the game no longer uses — deleting index.html leaves the preview with nothing to load.",
      inputSchema: z.object({
        path: z
          .string()
          .describe(
            "Path to the file or directory to delete, relative to the game directory."
          ),
      }),
      execute: ({ path: filePath }) =>
        expected("delete_file", gameId, filePath, async () => {
          const target = resolveGamePath(filePath)
          const box = await sandbox()
          const info = await statFile(box, target)

          if (!info) {
            return `No file at ${relative(target)}.`
          }

          // A directory needs `recursive` or the delete fails; the path is
          // already known to be inside the game directory.
          await box.fs.deleteFile(target, info.isDir)

          return info.isDir
            ? `Deleted ${relative(target)} and everything in it.`
            : `Deleted ${relative(target)}.`
        }),
    }),

    ask_player: askPlayer,
  }
}

/** The tools, as declared on the chat agent. */
export type GameTools = ReturnType<typeof createGameTools>

/**
 * A failure the model can fix by calling the tool differently.
 *
 * Thrown from the helpers so a check can bail from anywhere, and turned back
 * into a plain tool result by `expected` — the model reads it as an answer and
 * corrects course, instead of the turn dying on a rejected tool call.
 */
class ToolInputError extends Error {}

/**
 * Runs a tool call, turning a `ToolInputError` back into a plain result, and
 * logs how it went either way.
 *
 * This is the only path every tool call passes through, which makes it the one
 * place worth logging them from: one wide event per call, carrying the tool,
 * the game, the path it was pointed at and what it cost. That record is the
 * agent's entire effect on a game — the chat thread shows what the model said
 * it did, and this shows what actually reached the sandbox.
 *
 * The three outcomes are deliberately three levels. A refused call is a `warn`:
 * the model mis-called the tool and will read the message and correct itself,
 * so it is not a failure of the system, but a stream of them means the tool
 * descriptions are not landing. A thrown call is an `error` and takes the turn
 * down with it.
 */
async function expected(
  tool: string,
  gameId: string,
  target: string | undefined,
  run: () => Promise<string>
): Promise<string> {
  const startedAt = performance.now()

  // `gen_ai.tool.name` and the game id go on every one of these, so a single
  // turn's worth of calls can be pulled up as a group and read in order.
  const attributes: Record<string, string | number | boolean> = {
    "gen_ai.operation.name": "execute_tool",
    "gen_ai.tool.name": tool,
    "game.id": gameId,
  }

  // The path the model asked for, before it is resolved — an argument the
  // model chose, and the thing most worth having when a call went wrong.
  // Contents are never logged: game source stays out of Sentry, in line with
  // the `httpBodies: []` stance in the SDK configs.
  if (target !== undefined && target !== "") {
    attributes["code.file.path"] = target
  }

  try {
    const result = await run()

    logger.info(logger.fmt`Agent called ${tool}`, {
      ...attributes,
      duration_ms: elapsed(startedAt),
    })

    return result
  } catch (error) {
    if (error instanceof ToolInputError) {
      logger.warn(logger.fmt`Agent called ${tool} with unusable input`, {
        ...attributes,
        "tool.refusal": error.message,
        duration_ms: elapsed(startedAt),
      })

      return error.message
    }

    logger.error(logger.fmt`Agent's call to ${tool} failed`, {
      ...attributes,
      ...describeError(error),
      duration_ms: elapsed(startedAt),
    })

    throw error
  }
}

/**
 * Turns a path from the model into an absolute path inside the game directory.
 *
 * This is the only place a tool path becomes a real path, so it is also the
 * confinement: an absolute path, a `..` climb or a symlink-ish name all end up
 * measured against `GAME_DIR` here, and anything landing outside is refused
 * before it reaches the sandbox.
 */
function resolveGamePath(
  input: string,
  { allowRoot = false }: { allowRoot?: boolean } = {}
): string {
  const trimmed = input.trim()

  if (trimmed === "") {
    throw new ToolInputError("path cannot be empty.")
  }

  if (!SAFE_PATH.test(trimmed)) {
    throw new ToolInputError(
      `"${trimmed}" isn't a usable path. Use letters, digits, dots, dashes, underscores and slashes only.`
    )
  }

  const resolved = path.posix.resolve(GAME_DIR, trimmed)

  if (resolved !== GAME_DIR && !resolved.startsWith(`${GAME_DIR}/`)) {
    throw new ToolInputError(
      `"${trimmed}" is outside the game directory. Every path is relative to ${GAME_DIR} and has to stay inside it.`
    )
  }

  if (resolved === GAME_DIR && !allowRoot) {
    throw new ToolInputError(
      "That is the game directory itself. Name a file inside it."
    )
  }

  return resolved
}

/** A path as the agent wrote it — relative to the game directory. */
function relative(fullPath: string): string {
  return path.posix.relative(GAME_DIR, fullPath) || "."
}

/**
 * A path's metadata, or `null` if nothing is there.
 *
 * The toolbox has no "does this exist" call and answers a missing path with an
 * error, so a throw is how absence arrives. Every caller follows this with a
 * read, write or delete of the same path, which surfaces a genuine failure
 * (permissions, a dead sandbox) a moment later anyway.
 */
async function statFile(
  sandbox: Sandbox,
  fullPath: string
): Promise<FileInfo | null> {
  try {
    return await sandbox.fs.getFileDetails(fullPath)
  } catch {
    return null
  }
}

function lineCount(content: string): number {
  return content === "" ? 0 : content.split("\n").length
}
