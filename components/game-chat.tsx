"use client"

import type { ChatSessionPersistedState } from "@trigger.dev/sdk/chat"
import type { UIMessage } from "ai"
import { useRouter } from "next/navigation"
import { useCallback, useState } from "react"

import { ChatPreview } from "@/components/chat-preview"
import { ChatThread } from "@/components/chat-thread"
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable"
import type { GameModelId } from "@/lib/games/model-catalog"

export function GameChat({
  gameId,
  credits,
  initialMessages,
  initialModelId,
  initialSession,
  sandboxId,
}: {
  gameId: string
  /** The organization's balance when the page was rendered. */
  credits: bigint
  initialMessages: UIMessage[]
  /** The model this thread opens on — see `GamePage` for where it comes from. */
  initialModelId: GameModelId
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

  const router = useRouter()

  const handleTurnComplete = useCallback(() => {
    setPreviewRevision((revision) => revision + 1)
    setHasSandbox(true)

    // The turn just spent credits, and the sidebar that shows the balance is
    // rendered by the layout above this page — server-side, once, when the
    // route was entered. Re-rendering it is what makes the number move; the
    // refresh keeps this component's own state, so the thread and the preview
    // are untouched by it.
    router.refresh()
  }, [router])

  const thread = (
    <ChatThread
      gameId={gameId}
      credits={credits}
      initialMessages={initialMessages}
      initialModelId={initialModelId}
      initialSession={initialSession}
      onTurnComplete={handleTurnComplete}
    />
  )

  // The panel group hard-codes `height: 100%` as an inline style, so no height
  // class of ours can outrank it — the height has to come from a parent
  // instead, and `min-h-0` is what lets this one shrink to what the page's
  // column leaves it. Without a definite height the chain up to the sidebar
  // inset is all `auto`, and a long thread grows the group past the window and
  // scrolls the page rather than the message scroller.
  //
  // The group is here even before there is anything to preview, so that the
  // thread keeps the same place in the tree throughout. Rendering it somewhere
  // else while the second panel is missing would unmount and remount it the
  // moment the first turn produces a sandbox — and a remounted `ChatThread`
  // rebuilds `useChat` from the props of the last *server* render, which still
  // end on the opening prompt. It would ask for a reply to a message the agent
  // has just finished answering, and that turn reaches the model as a thread
  // ending in its own words, which is not something a model can continue.
  //
  // A lone panel grows to fill the group, so nothing about the layout depends
  // on the preview being there.
  return (
    <div className="min-h-0 flex-1">
      <ResizablePanelGroup>
        <ResizablePanel
          defaultSize="40"
          minSize="25"
          className="flex h-full flex-col"
        >
          {thread}
        </ResizablePanel>
        {/* The sandbox is created on the thread's first turn, so until then
            there is nothing to show beside it — and a handle against an empty
            panel is worse than no split at all. */}
        {hasSandbox && (
          <>
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
          </>
        )}
      </ResizablePanelGroup>
    </div>
  )
}
