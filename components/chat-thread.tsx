"use client"

import { useChat } from "@ai-sdk/react"
import type { ChatSessionPersistedState } from "@trigger.dev/sdk/chat"
import { useTriggerChatTransport } from "@trigger.dev/sdk/chat/react"
import type { UIMessage } from "ai"
import Image from "next/image"
import { useCallback, useEffect, useRef, useState } from "react"

import { ChatComposer } from "@/components/chat-composer"
import { Bubble, BubbleContent } from "@/components/ui/bubble"
import { Message, MessageAvatar, MessageContent } from "@/components/ui/message"
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller"
import {
  mintGameChatAccessToken,
  startGameChatSession,
} from "@/lib/games/chat-actions"
// Type-only: the agent module reaches the server bundle, never the browser.
import type { gameChat } from "@/trigger/chat"

export function ChatThread({
  gameId,
  initialMessages,
  initialSession,
}: {
  gameId: string
  initialMessages: UIMessage[]
  initialSession?: ChatSessionPersistedState
}) {
  const [prompt, setPrompt] = useState("")
  // There is no endpoint to point at — the transport talks to the chat agent
  // directly, and both callbacks are server actions so the browser never holds
  // an environment secret key. The chat id doubles as the game id the thread is
  // persisted under.
  const transport = useTriggerChatTransport<typeof gameChat>({
    task: "game-chat",
    accessToken: ({ chatId }) => mintGameChatAccessToken(chatId),
    startSession: ({ chatId, clientData }) =>
      startGameChatSession({ chatId, clientData }),
    // What the last turn persisted: the session token and the stream cursor, so
    // a fresh tab reconnects without a round-trip to create a session.
    sessions: initialSession ? { [gameId]: initialSession } : undefined,
  })

  const {
    messages,
    sendMessage,
    stop: stopStream,
    status,
  } = useChat({
    id: gameId,
    messages: initialMessages,
    transport,
    // Only a game that has already had a turn has a stream to rejoin.
    resume: Boolean(initialSession),
  })

  // A game is created with its opening prompt already stored as the thread's
  // first message, so a new thread arrives with a user turn and no reply. Ask
  // for that reply once per game: `sendMessage()` with no argument submits the
  // messages already in the thread instead of appending another one.
  const submittedGameId = useRef<string | null>(null)

  useEffect(() => {
    if (submittedGameId.current === gameId) {
      return
    }

    submittedGameId.current = gameId

    if (initialMessages.at(-1)?.role === "user") {
      sendMessage()
    }
  }, [gameId, initialMessages, sendMessage])

  function handleSubmit(value: string) {
    sendMessage({ text: value })
    setPrompt("")
  }

  // Two halves of one cancel: `stopGeneration` signals the run so the agent
  // aborts its `streamText` (the run itself stays alive for the next message),
  // and `stopStream` settles the local status back to ready. `useChat`'s stop
  // alone never reaches the backend on a resumed stream, which is every stream
  // this thread rejoins after a refresh.
  const handleStop = useCallback(() => {
    void transport.stopGeneration(gameId)
    stopStream()
  }, [transport, gameId, stopStream])

  return (
    <div className="flex h-full flex-col">
      <MessageScrollerProvider>
        <MessageScroller className="flex-1">
          <MessageScrollerViewport>
            <MessageScrollerContent className="mx-auto w-full max-w-3xl px-4 py-8">
              {messages.map((message) => (
                <MessageScrollerItem key={message.id} messageId={message.id}>
                  <Message align={message.role === "user" ? "end" : "start"}>
                    {message.role === "assistant" && (
                      <MessageAvatar className="size-8 bg-transparent self-start rounded-lg">
                        <Image
                          src="/logo.svg"
                          alt="Sandbox"
                          width={32}
                          height={32}
                          className="size-8"
                        />
                      </MessageAvatar>
                    )}
                    <MessageContent>
                      <Bubble
                        variant={message.role === "user" ? "secondary" : "ghost"}
                        align={message.role === "user" ? "end" : "start"}
                      >
                        <BubbleContent>
                          {message.parts.map((part, index) =>
                            part.type === "text" ? (
                              <span key={index}>{part.text}</span>
                            ) : null,
                          )}
                        </BubbleContent>
                      </Bubble>
                    </MessageContent>
                  </Message>
                </MessageScrollerItem>
              ))}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerButton />
        </MessageScroller>
      </MessageScrollerProvider>
      <div className="mx-auto w-full max-w-3xl shrink-0 px-4 pb-4">
        <ChatComposer
          value={prompt}
          onValueChange={setPrompt}
          onSubmit={handleSubmit}
          onStop={handleStop}
          streaming={status === "submitted" || status === "streaming"}
          disabled={status !== "ready"}
          placeholder="Ask for a change…"
        />
      </div>
    </div>
  )
}
