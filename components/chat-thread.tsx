"use client"

import { useChat } from "@ai-sdk/react"
import Image from "next/image"
import { useState } from "react"

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

export function ChatThread() {
  const [prompt, setPrompt] = useState("")
  // The route handler lives at the transport's default endpoint, `/api/chat`.
  const { messages, sendMessage, status } = useChat()

  function handleSubmit(value: string) {
    sendMessage({ text: value })
    setPrompt("")
  }

  return (
    <div className="flex h-svh flex-col">
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
          disabled={status !== "ready"}
          placeholder="Ask for a change…"
        />
      </div>
    </div>
  )
}
