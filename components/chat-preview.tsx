"use client"

import { useEffect, useState } from "react"

import { Spinner } from "@/components/ui/spinner"

type Preview =
  | { status: "loading" }
  | { status: "ready"; url: string }
  | { status: "error"; message: string }

/**
 * The running game, embedded from its sandbox.
 *
 * The url can't be resolved on the server with the rest of the page: fetching
 * it starts the sandbox's server, which takes seconds on a cold sandbox and
 * would hold the whole chat behind it. So the panel mounts first and asks for
 * the url itself.
 *
 * Mounted under a `key` of the game id, so switching games remounts this with
 * fresh state instead of showing the previous game while the new url loads.
 */
export function ChatPreview({ gameId }: { gameId: string }) {
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

        setPreview({ status: "ready", url: body.url })
      } catch (error) {
        // The abort is this effect being torn down, not a failure to report.
        if (controller.signal.aborted) {
          return
        }

        setPreview({
          status: "error",
          message:
            error instanceof Error ? error.message : "Preview is unavailable",
        })
      }
    }

    void load()

    return () => controller.abort()
  }, [gameId])

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
      src={preview.url}
      title="Game preview"
      className="h-full w-full border-0 bg-white"
    />
  )
}
