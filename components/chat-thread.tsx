"use client"

import { useChat } from "@ai-sdk/react"
import * as Sentry from "@sentry/nextjs"
import type { ChatSessionPersistedState } from "@trigger.dev/sdk/chat"
import { useTriggerChatTransport } from "@trigger.dev/sdk/chat/react"
import {
  getToolName,
  isToolUIPart,
  lastAssistantMessageIsCompleteWithToolCalls,
} from "ai"
import type { DynamicToolUIPart, ToolUIPart, UIMessage } from "ai"
import {
  CheckIcon,
  CircleAlertIcon,
  CircleQuestionMarkIcon,
} from "lucide-react"
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
import {
  Questionnaire,
  QuestionnaireActions,
  QuestionnaireChoice,
  QuestionnaireChoiceDescription,
  QuestionnaireChoices,
  QuestionnaireError,
  QuestionnaireItem,
  QuestionnaireSubmit,
  QuestionnaireTitle,
} from "@/components/ui/questionnaire"
import { Spinner } from "@/components/ui/spinner"
import {
  mintGameChatAccessToken,
  startGameChatSession,
} from "@/lib/games/chat-actions"
import { describeError } from "@/lib/observability"
import { cn } from "@/lib/utils"
// Type-only: the agent module reaches the server bundle, never the browser.
import type { gameChat } from "@/trigger/chat"

/** The tool the agent asks with, rather than one it edits the game with. */
const ASK_PLAYER = "ask_player"

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

  // Read inside `onError`, which `useChat` holds from the render it was created
  // in — reading `messages` there directly would report the thread as it was
  // when the callback was made rather than when the turn failed.
  const messageCount = useRef(0)

  const {
    messages,
    sendMessage,
    addToolOutput,
    stop: stopStream,
    status,
  } = useChat({
    id: gameId,
    messages: initialMessages,
    transport,
    // Answering `ask_player` resolves the tool call the paused turn is sitting
    // on, and that answer is only useful to the agent if it goes back — this
    // submits the thread again the moment the last message has no tool call
    // left waiting, so the player never has to press send to be understood.
    //
    // It reads the last *step* only, so an ordinary turn (tool calls, then a
    // closing message) doesn't retrigger itself: that step has no tool calls
    // in it at all.
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
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
    // A turn that dies — the run failing, the transport losing the stream,
    // a token that could not be refreshed — settles the status back to ready
    // and leaves the thread looking like the agent simply had nothing to say.
    // Nothing else in the app sees this: the worker's own failure is logged on
    // its side only when the run itself failed, and a transport error never
    // gets that far.
    onError: (error) => {
      Sentry.logger.error(
        Sentry.logger.fmt`Chat turn failed for game ${gameId}`,
        {
          "game.id": gameId,
          "chat.messages": messageCount.current,
          "chat.resumed": Boolean(initialSession),
          ...describeError(error),
        }
      )

      // The log says a turn failed; this says why, with a stack trace and the
      // replay of the session it happened in attached.
      Sentry.captureException(error, {
        tags: { "game.id": gameId },
      })
    },
  })

  // Synced in an effect rather than assigned during render, which is a ref
  // write React's rules — rightly — refuse.
  useEffect(() => {
    messageCount.current = messages.length
  }, [messages])

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

  // A question the agent is still waiting on. The turn paused on a tool call
  // with no result, so the thread can only move once that call is answered:
  // anything else sent now would ask the model to carry on from a question it
  // never heard back about. The composer closes until they pick.
  //
  // Only the last message is ever in this state, which is also the only
  // message `addToolOutput` can patch — so it doubles as which card is live.
  const lastMessage = messages.at(-1)
  const pendingQuestion = Boolean(
    lastMessage?.parts.some(
      (part) =>
        isToolUIPart(part) &&
        getToolName(part) === ASK_PLAYER &&
        part.state === "input-available"
    )
  )

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
                      <MessageAvatar className="size-8 self-start rounded-lg bg-transparent">
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
                        variant={
                          message.role === "user" ? "secondary" : "ghost"
                        }
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

                            // The one tool the player answers rather than
                            // the sandbox: it gets a question card, not a
                            // line in the log.
                            if (
                              isToolUIPart(part) &&
                              getToolName(part) === ASK_PLAYER
                            ) {
                              return (
                                <AskPlayerCard
                                  key={part.toolCallId}
                                  part={part}
                                  // Answerable only on the last message, the
                                  // only one `addToolOutput` writes to. An
                                  // older card is history and renders as such.
                                  onAnswer={
                                    message.id === lastMessage?.id
                                      ? (option) =>
                                          void addToolOutput({
                                            tool: ASK_PLAYER,
                                            toolCallId: part.toolCallId,
                                            output: {
                                              optionId: option.id,
                                              label: option.label,
                                            },
                                          })
                                      : undefined
                                  }
                                />
                              )
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
          disabled={status !== "ready" || pendingQuestion}
          placeholder={
            pendingQuestion ? "Pick an answer above…" : "Ask for a change…"
          }
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
  [ASK_PLAYER]: { active: "Asking", done: "Asked" },
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

/**
 * The name the question submits under.
 *
 * The primitive is built for a run of questions and reads answers off the form
 * by item name; a card holds exactly one, so one constant name covers it.
 */
const ASK_ITEM = "answer"

/**
 * The part of the game a question is about, as `dimension` names it.
 *
 * Shown above the question, so the choice is framed before it is read: the
 * options only make sense against each other once you know which part of the
 * game they are all answers about.
 */
const ASK_DIMENSIONS: Record<string, string> = {
  loop: "the core loop",
  goal: "the goal",
  challenge: "the challenge",
  controls: "the controls",
  world: "the world",
  look: "the look",
  feel: "the feel",
}

type AskPlayerOption = { id: string; label: string; description?: string }

/**
 * The agent's question, waiting on an answer from the player.
 *
 * The tool has no `execute`, so the turn ends here with the call unresolved
 * and the run suspended. Answering resolves it locally and — through
 * `sendAutomaticallyWhen` — sends the thread straight back, which wakes the
 * run and lets it carry on building from the choice.
 *
 * `onAnswer` is what makes the card live. Without it the question is history:
 * one the turn has already moved past, or one on a message too old to patch.
 */
function AskPlayerCard({
  part,
  onAnswer,
}: {
  part: ToolUIPart | DynamicToolUIPart
  onAnswer?: (option: AskPlayerOption) => void
}) {
  const asked = askPlayerInput(part.input)

  // Nothing to put to anyone until the whole question has arrived — the input
  // streams in a token at a time, and a call that failed outright never asked
  // anything. Both read as an ordinary call in the log.
  if (!asked || part.state === "input-streaming") {
    return <ToolCallMarker part={part} />
  }

  if (part.state === "output-error" || part.state === "output-denied") {
    return <ToolCallMarker part={part} />
  }

  const dimension = asked.dimension && ASK_DIMENSIONS[asked.dimension]
  const answered =
    part.state === "output-available" ? askPlayerAnswer(part.output) : undefined

  return (
    <div className="flex w-full max-w-md flex-col gap-3">
      <Marker>
        <MarkerIcon>
          <CircleQuestionMarkIcon />
        </MarkerIcon>
        <MarkerContent>
          {dimension ? `A question about ${dimension}` : "A question"}
        </MarkerContent>
      </Marker>

      {onAnswer && part.state === "input-available" ? (
        <Questionnaire
          shortcuts="letters"
          onSubmit={(event) => {
            // The primitive validates first and only calls this once an option
            // is picked; without this the form would navigate the page.
            event.preventDefault()

            const picked = new FormData(event.currentTarget).get(ASK_ITEM)
            const option = asked.options.find(({ id }) => id === picked)

            if (option) {
              onAnswer(option)
            }
          }}
        >
          <QuestionnaireItem name={ASK_ITEM} required>
            <QuestionnaireTitle>{asked.question}</QuestionnaireTitle>
            <QuestionnaireChoices>
              {asked.options.map((option) => (
                <QuestionnaireChoice key={option.id} value={option.id}>
                  {option.label}
                  {option.description && (
                    <QuestionnaireChoiceDescription>
                      {option.description}
                    </QuestionnaireChoiceDescription>
                  )}
                </QuestionnaireChoice>
              ))}
            </QuestionnaireChoices>
            <QuestionnaireError />
          </QuestionnaireItem>
          <QuestionnaireActions>
            <QuestionnaireSubmit size="sm">Build this</QuestionnaireSubmit>
          </QuestionnaireActions>
        </Questionnaire>
      ) : (
        // Settled: the options were a way to answer, and once answered they
        // are noise. What stays is what was asked and what was picked.
        <div className="flex flex-col gap-2">
          <p className="font-heading text-base leading-snug font-medium text-pretty">
            {asked.question}
          </p>
          <Marker>
            <MarkerIcon>
              {answered ? <CheckIcon /> : <CircleAlertIcon />}
            </MarkerIcon>
            <MarkerContent>
              {answered ? (
                <span className="text-foreground">{answered}</span>
              ) : (
                "Left unanswered"
              )}
            </MarkerContent>
          </Marker>
        </div>
      )}
    </div>
  )
}

/**
 * A question, once the whole of one has arrived.
 *
 * Read defensively for the same reason as `toolCallTarget`: the thread renders
 * untyped `UIMessage`s, so the input is `unknown` here, and mid-stream it is a
 * partial object that may hold half a question and one option so far. Anything
 * short of a question with two options to answer it isn't askable yet.
 */
function askPlayerInput(input: unknown): {
  dimension?: string
  question: string
  options: AskPlayerOption[]
} | null {
  if (typeof input !== "object" || input === null) {
    return null
  }

  const { dimension, question, options } = input as {
    dimension?: unknown
    question?: unknown
    options?: unknown
  }

  if (typeof question !== "string" || question === "") {
    return null
  }

  const parsed = (Array.isArray(options) ? options : []).flatMap(
    (option): AskPlayerOption[] => {
      if (typeof option !== "object" || option === null) {
        return []
      }

      const { id, label, description } = option as {
        id?: unknown
        label?: unknown
        description?: unknown
      }

      if (typeof id !== "string" || id === "" || typeof label !== "string") {
        return []
      }

      return [
        {
          id,
          label,
          description:
            typeof description === "string" ? description : undefined,
        },
      ]
    }
  )

  if (parsed.length < 2) {
    return null
  }

  return {
    dimension: typeof dimension === "string" ? dimension : undefined,
    question,
    options: parsed,
  }
}

/** The label of the option the player picked, out of the tool's output. */
function askPlayerAnswer(output: unknown): string | undefined {
  if (typeof output !== "object" || output === null) {
    return undefined
  }

  const { label } = output as { label?: unknown }

  return typeof label === "string" && label !== "" ? label : undefined
}
