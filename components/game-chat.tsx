"use client"

import type { ChatSessionPersistedState } from "@trigger.dev/sdk/chat"
import type { UIMessage } from "ai"
import { useCallback, useState } from "react"

import { ChatPreview } from "@/components/chat-preview"
import { ChatThread } from "@/components/chat-thread"
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable"

export function GameChat({
  gameId,
  initialMessages,
  initialSession,
  sandboxId,
}: {
  gameId: string
  initialMessages: UIMessage[]
  initialSession?: ChatSessionPersistedState
  sandboxId: string | null
}) {
  // What the preview is showing, counted in finished turns. The panel loads
  // the game once per value, so bumping it is how a turn's edits reach the
  // player — see `ChatPreview` for why a reload needs a new number rather than
  // just a new fetch.
  const [previewRevision, setPreviewRevision] = useState(0)

  // The sandbox is created on the thread's first turn, so a game opened before
  // then has nothing to preview — but by the time that turn finishes it does,
  // and it holds the game the user just asked for. Server-rendered `sandboxId`
  // is therefore only the starting answer, not the standing one.
  const [hasSandbox, setHasSandbox] = useState(sandboxId !== null)

  const handleTurnComplete = useCallback(() => {
    setPreviewRevision((revision) => revision + 1)
    setHasSandbox(true)
  }, [])

  const thread = (
    <ChatThread
      gameId={gameId}
      initialMessages={initialMessages}
      initialSession={initialSession}
      onTurnComplete={handleTurnComplete}
    />
  )

  // Drop the split entirely rather than leave a resizable handle beside an
  // empty panel — the thread gets the window, and centers itself in it on its
  // own.
  if (!hasSandbox) {
    return <div className="flex h-svh flex-col">{thread}</div>
  }

  // The panel group hard-codes `height: 100%` as an inline style, so no height
  // class of ours can outrank it — the window height has to come from a parent
  // instead. Without one the chain up to the sidebar inset is all `auto`, and a
  // long thread grows the group past the window and scrolls the page rather
  // than the message scroller.
  return (
    <div className="h-svh">
      <ResizablePanelGroup>
        <ResizablePanel
          defaultSize="40"
          minSize="25"
          className="flex h-full flex-col"
        >
          {thread}
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel
          defaultSize="60"
          minSize="30"
          className="flex h-full flex-col"
        >
          <ChatPreview
            key={gameId}
            gameId={gameId}
            revision={previewRevision}
          />
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  )
}
