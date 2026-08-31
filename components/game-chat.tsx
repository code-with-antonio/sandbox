"use client"

import type { ChatSessionPersistedState } from "@trigger.dev/sdk/chat"
import type { UIMessage } from "ai"

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
  const thread = (
    <ChatThread
      gameId={gameId}
      initialMessages={initialMessages}
      initialSession={initialSession}
    />
  )

  // The sandbox is created on the thread's first turn, so a game opened before
  // then has nothing to preview. Drop the split entirely rather than leave a
  // resizable handle beside an empty panel — the thread gets the window, and
  // centers itself in it on its own.
  if (!sandboxId) {
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
          <ChatPreview key={gameId} gameId={gameId} />
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  )
}
