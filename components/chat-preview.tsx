"use client"

import { useEffect, useState } from "react"

import { Spinner } from "@/components/ui/spinner"

type Preview =
  | { status: "loading" }
  | { status: "ready"; url: string; revision: number }
  | { status: "error"; message: string }

/**
 * The running game, embedded from its sandbox.
 *
 * The url can't be resolved on the server with the rest of the page: fetching
 * it starts the sandbox's server, which takes seconds on a cold sandbox and
 * would hold the whole chat behind it. So the panel mounts first and asks for
 * the url itself.
 *
 * `revision` is bumped by whoever owns the thread every time a turn finishes,
 * and every value of it — including the first — is one load of the game. That
 * is the whole reload: the agent's edits land in the sandbox during the turn,
 * so the build to show is whatever is on disk when the turn ends.
 *
 * Mounted under a `key` of the game id, so switching games remounts this with
 * fresh state instead of showing the previous game while the new url loads.
 */
export function ChatPreview({
  gameId,
  revision,
}: {
  gameId: string
  revision: number
}) {
  const [preview, setPreview] = useState<Preview>({ status: "loading" })

  useEffect(() => {
    const controller = new AbortController()

    async function load() {
      try {
        const response = await fetch(`/api/games/${gameId}/preview`, {
          signal: controller.signal,
        })
        const body = await response.json()

        if (!response.ok) {
          throw new Error(body.error ?? "Preview is unavailable")
        }

        setPreview({ status: "ready", url: body.url, revision })
      } catch (error) {
        // The abort is this effect being torn down, not a failure to report.
        if (controller.signal.aborted) {
          return
        }

        const message =
          error instanceof Error ? error.message : "Preview is unavailable"

        // A reload that fails leaves the game already on screen where it is.
        // It is the previous turn's build rather than the latest one, but the
        // panel has no retry of its own — trading a working preview for an
        // error message would strand the player there until the next turn.
        setPreview((current) =>
          current.status === "ready" ? current : { status: "error", message }
        )
      }
    }

    void load()

    return () => controller.abort()
  }, [gameId, revision])

  if (preview.status === "loading") {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
        <Spinner />
        Starting preview…
      </div>
    )
  }

  if (preview.status === "error") {
    return (
      <p className="flex h-full items-center justify-center p-4 text-center text-sm text-muted-foreground">
        {preview.message}
      </p>
    )
  }

  return (
    <iframe
      // Daytona signs a preview url per sandbox, not per build, so a reload
      // normally hands the iframe the src it is already showing — and setting
      // `src` to its current value is not a navigation. The revision keys the
      // element instead, so React tears the old frame down and mounts a new
      // one, which loads whatever the sandbox now serves.
      key={preview.revision}
      src={preview.url}
      title="Game preview"
      className="h-full w-full border-0 bg-white"
    />
  )
}
