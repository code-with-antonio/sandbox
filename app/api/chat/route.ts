import { anthropic } from "@ai-sdk/anthropic"
import { auth } from "@clerk/nextjs/server"
import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  streamText,
  toUIMessageStream,
  validateUIMessages,
  type UIMessage,
} from "ai"

import { generateMessageId, saveGameMessages } from "@/lib/games/messages"
import { getGame } from "@/lib/games/queries"

/**
 * Streams a chat completion back to `useChat`. A game owns exactly one thread,
 * so the chat id is the game id: the client sends the full history on every
 * turn and the completed thread is written back to the game.
 */
export async function POST(req: Request) {
  const { userId, orgId } = await auth()

  if (!userId || !orgId) {
    return new Response("Unauthorized", { status: 401 })
  }

  const { id, messages }: { id: string; messages: UIMessage[] } =
    await req.json()

  // Also the authorization check — `getGame` only resolves games belonging to
  // the caller's active organization.
  const game = await getGame(id)

  if (!game) {
    return new Response("Not Found", { status: 404 })
  }

  // The thread is persisted, so guard the shape of what gets written back.
  const validatedMessages = await validateUIMessages({ messages })

  const result = streamText({
    model: anthropic("claude-sonnet-5"),
    messages: await convertToModelMessages(validatedMessages),
  })

  // Run the stream to completion even if the client goes away, so the turn is
  // still saved.
  result.consumeStream()

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({
      stream: result.stream,
      originalMessages: validatedMessages,
      generateMessageId,
      onEnd: ({ messages }) =>
        saveGameMessages({ gameId: game.id, orgId, messages }),
    }),
  })
}
