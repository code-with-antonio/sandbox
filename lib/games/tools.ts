import path from "node:path"

import type { FileInfo, Sandbox } from "@daytona/sdk"
import { tool } from "ai"
import { z } from "zod"

import { GAME_DIR, getGameSandbox } from "@/lib/daytona/utils"

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
 * The file tools the agent edits a game with.
 *
 * Built per game rather than declared once, because every call has to land in
 * *this* game's sandbox and the model never sees a game id — the id is closed
 * over here instead of being an argument the model could get wrong.
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
      .catch((error) => {
        pending = undefined
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
        expected(async () => {
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
        expected(async () => {
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
        expected(async () => {
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
        expected(async () => {
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
        expected(async () => {
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
  }
}

/** The file tools, as declared on the chat agent. */
export type GameTools = ReturnType<typeof createGameTools>

/**
 * A failure the model can fix by calling the tool differently.
 *
 * Thrown from the helpers so a check can bail from anywhere, and turned back
 * into a plain tool result by `expected` — the model reads it as an answer and
 * corrects course, instead of the turn dying on a rejected tool call.
 */
class ToolInputError extends Error {}

async function expected(run: () => Promise<string>): Promise<string> {
  try {
    return await run()
  } catch (error) {
    if (error instanceof ToolInputError) {
      return error.message
    }

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
