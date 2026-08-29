import Image from "next/image"

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

const messages = [
  {
    id: "1",
    role: "user",
    content: "Make me a top-down racer set on a neon city rooftop circuit.",
  },
  {
    id: "2",
    role: "assistant",
    content:
      "On it. I'll start with a single rooftop loop, arcade-style drifting, and a lap timer. Neon signs and a wet-asphalt reflection for the mood — you'll be able to drive it in about a minute.",
  },
  {
    id: "3",
    role: "user",
    content: "Can the car drift more? It feels glued to the road right now.",
  },
  {
    id: "4",
    role: "assistant",
    content:
      "Loosened the rear grip and added a handbrake on space. Hold it through a corner and the back end steps out, then the tires recover once you straighten up. Tire marks stay on the track for a few seconds.",
  },
  {
    id: "5",
    role: "user",
    content: "Nice. Add three rival cars and a countdown before the start.",
  },
  {
    id: "6",
    role: "assistant",
    content:
      "Added three rivals that follow the racing line and fight for position, plus a 3-2-1 countdown that locks your controls until the lights go out. Want me to add a second track next?",
  },
]

export function ChatThread() {
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
                        <BubbleContent>{message.content}</BubbleContent>
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
        <ChatComposer />
      </div>
    </div>
  )
}
