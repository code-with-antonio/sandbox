import { readdir } from "node:fs/promises"
import path from "node:path"

import type { FileUpload } from "@daytona/sdk"

// The seed files themselves live in `./runtime`, as the files they are, so
// they can be edited as html/css/js rather than as strings in a module.
//
// Resolved from the process' working directory rather than from this module's
// url: this code is bundled into the Trigger.dev worker, so `import.meta.url`
// points at a build artifact, while the working directory is the project root
// in dev and the deployment root in production — both of which `runtime/*`
// keeps its path relative to (see `additionalFiles` in `@/trigger.config`).
const RUNTIME_DIR = path.join(process.cwd(), "lib", "games", "runtime")

/**
 * Every file under `./runtime`, addressed to where it belongs in a sandbox.
 *
 * The tree is walked rather than listed, so a file added to `runtime/` — at
 * any depth — is seeded without anything here having to learn its name.
 *
 * Folders come back separately, parents first, because an upload names a
 * destination path but doesn't create the directories leading to it.
 *
 * Sources stay as local paths, which the SDK streams from disk, instead of
 * buffers read into the worker's memory.
 */
export async function readRuntimeFiles(destination: string): Promise<{
  folders: string[]
  files: FileUpload[]
}> {
  const entries = await readdir(RUNTIME_DIR, {
    recursive: true,
    withFileTypes: true,
  })

  const folders: string[] = []
  const files: FileUpload[] = []

  for (const entry of entries) {
    const source = path.join(entry.parentPath, entry.name)
    // Sandbox paths are posix regardless of what this worker runs on.
    const target = path.posix.join(
      destination,
      ...path.relative(RUNTIME_DIR, source).split(path.sep)
    )

    if (entry.isDirectory()) {
      folders.push(target)
    } else {
      files.push({ source, destination: target })
    }
  }

  // `readdir` gives no ordering guarantee across directory levels, and a
  // nested folder can only be created once its parent exists.
  folders.sort((a, b) => a.length - b.length)

  return { folders, files }
}
