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

  return (
    <ResizablePanelGroup className="h-svh">
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
  )
}
