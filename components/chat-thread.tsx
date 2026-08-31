"use client"

import { useChat } from "@ai-sdk/react"
import type { ChatSessionPersistedState } from "@trigger.dev/sdk/chat"
import { useTriggerChatTransport } from "@trigger.dev/sdk/chat/react"
import { getToolName, isToolUIPart } from "ai"
import type { DynamicToolUIPart, ToolUIPart, UIMessage } from "ai"
import { CheckIcon, CircleAlertIcon } from "lucide-react"
import Image from "next/image"
import { useCallback, useEffect, useRef, useState } from "react"

import { ChatComposer } from "@/components/chat-composer"
import { Bubble, BubbleContent } from "@/components/ui/bubble"
import { Marker, MarkerContent, MarkerIcon } from "@/components/ui/marker"
import { Message, MessageAvatar, MessageContent } from "@/components/ui/message"
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller"
import { Spinner } from "@/components/ui/spinner"
import {
  mintGameChatAccessToken,
  startGameChatSession,
} from "@/lib/games/chat-actions"
import { cn } from "@/lib/utils"
// Type-only: the agent module reaches the server bundle, never the browser.
import type { gameChat } from "@/trigger/chat"

export function ChatThread({
  gameId,
  initialMessages,
  initialSession,
  onTurnComplete,
}: {
  gameId: string
  initialMessages: UIMessage[]
  initialSession?: ChatSessionPersistedState
  onTurnComplete: () => void
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
    // The end of the agent's stream is the end of its turn, so this is where
    // the browser learns that `onTurnComplete` has run on the other side and
    // the sandbox now holds the build the turn produced.
    //
    // Called however the turn ended. A turn stopped halfway, or one that died
    // on an error, still leaves every file it wrote on disk — that is what the
    // player is running now, so it is what the preview should show.
    onFinish: onTurnComplete,
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
                        {/* A turn arrives as alternating text and tool parts,
                            one per step, so they stack rather than run together
                            on one line. */}
                        <BubbleContent className="flex flex-col items-start gap-2">
                          {message.parts.map((part, index) => {
                            if (part.type === "text") {
                              return <span key={index}>{part.text}</span>
                            }

                            // Covers both halves of a call: the part starts as
                            // the tool call and becomes the result in place, so
                            // one marker tracks it from start to finish.
                            if (isToolUIPart(part)) {
                              return (
                                <ToolCallMarker
                                  key={part.toolCallId}
                                  part={part}
                                />
                              )
                            }

                            return null
                          })}
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

/** One line per tool call: what the agent is doing to the game, and how it went. */
function ToolCallMarker({ part }: { part: ToolUIPart | DynamicToolUIPart }) {
  const status = toolCallStatus(part.state)
  const verbs = TOOL_VERBS[getToolName(part)] ?? FALLBACK_VERBS
  const target = toolCallTarget(part.input)

  return (
    <Marker
      className={cn("w-fit", status === "failed" && "text-destructive")}
      // The error text can be a paragraph — the line stays one line, and the
      // detail is a hover away.
      title={part.state === "output-error" ? part.errorText : undefined}
    >
      <MarkerIcon>
        {status === "active" ? (
          <Spinner />
        ) : status === "done" ? (
          <CheckIcon />
        ) : (
          <CircleAlertIcon />
        )}
      </MarkerIcon>
      <MarkerContent>
        {status === "active" ? verbs.active : verbs.done}
        {target && <span className="ml-1 text-foreground">{target}</span>}
        {status === "failed" && " — failed"}
      </MarkerContent>
    </Marker>
  )
}

/**
 * The three states worth showing, out of the seven a tool part moves through.
 *
 * Everything before an output exists — streaming input, a complete call still
 * waiting, an approval round-trip — reads the same way to someone watching:
 * the agent is working on it. A denied call is a call that produced nothing,
 * so it lands with the errors.
 */
function toolCallStatus(
  state: ToolUIPart["state"] | DynamicToolUIPart["state"]
): "active" | "done" | "failed" {
  switch (state) {
    case "output-available":
      return "done"
    case "output-error":
    case "output-denied":
      return "failed"
    default:
      return "active"
  }
}

// Present tense while the call is in flight, past tense once it has landed —
// a finished call reads wrong as a frozen "Reading".
const TOOL_VERBS: Record<string, { active: string; done: string }> = {
  read_file: { active: "Reading", done: "Read" },
  write_file: { active: "Writing", done: "Wrote" },
  replace_text: { active: "Editing", done: "Edited" },
  list_files: { active: "Listing files", done: "Listed files" },
  delete_file: { active: "Deleting", done: "Deleted" },
}

const FALLBACK_VERBS = { active: "Working", done: "Ran tool" }

/**
 * The file a call is about, when it names one.
 *
 * The thread is rendered from untyped `UIMessage`s, so the input arrives as
 * `unknown` — and mid-stream it is a partial object that may not have reached
 * `path` yet, which is the same "no target to show" case as a tool that takes
 * none.
 */
function toolCallTarget(input: unknown): string | undefined {
  if (typeof input !== "object" || input === null || !("path" in input)) {
    return undefined
  }

  const { path } = input as { path?: unknown }

  return typeof path === "string" && path !== "" ? path : undefined
}
