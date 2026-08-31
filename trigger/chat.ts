import { anthropic } from "@ai-sdk/anthropic"
import { chat, upsertIncomingMessage } from "@trigger.dev/sdk/ai"
import { stepCountIs, streamText } from "ai"

import { createGameSandbox } from "@/lib/daytona/utils"
import {
  loadGameMessages,
  saveGameMessages,
  saveGameTurn,
} from "@/lib/games/chat-store"
import { gameInstructions } from "@/lib/games/instructions"
import { createGameTools } from "@/lib/games/tools"

/**
 * A game's chat thread, run as one long-lived task per conversation.
 *
 * A game owns exactly one thread and the chat id is the game id, so the
 * `games` row stays the source of truth for history: `hydrateMessages` reads it
 * back at the top of every turn instead of trusting the copy the browser holds.
 *
 * Authorization happens before a session can exist, in the server actions in
 * `@/lib/games/chat-actions` — there is no Clerk session in here to scope by.
 */
export const gameChat = chat.agent({
  id: "game-chat",
  hydrateMessages: async ({ chatId, trigger, incomingMessages }) => {
    const stored = await loadGameMessages(chatId)

    // Appends a genuinely new user message and no-ops otherwise. A new game is
    // created with its opening prompt already stored, and the client replays
    // that same message to ask for the first reply — this dedupes it by id.
    if (upsertIncomingMessage(stored, { trigger, incomingMessages })) {
      await saveGameMessages({ gameId: chatId, messages: stored })
    }

    return stored
  },
  // Fires once per game, on the first message of its thread — so the sandbox
  // is created exactly once and is already seeded before `run` streams a reply.
  onChatStart: async ({ chatId }) => {
    await createGameSandbox(chatId)
  },
  onTurnComplete: async ({
    chatId,
    uiMessages,
    chatAccessToken,
    lastEventId,
  }) => {
    await saveGameTurn({
      gameId: chatId,
      messages: uiMessages,
      chatAccessToken,
      chatLastEventId: lastEventId,
    })
  },
  // Resolved per turn rather than declared once, because the tools have to
  // write into this game's sandbox: the chat id is the game id, so each turn's
  // set is closed over the right one and the model never names a game itself.
  // Declared on the config and handed back to `streamText` below, rather than
  // only passed there: history re-converted at the top of a later turn needs
  // the same set to make sense of the tool calls already in it.
  tools: ({ chatId }) => createGameTools(chatId),
  run: async ({ messages, tools, signal }) =>
    streamText({
      // Spread first, so every option below still wins. Wires up the
      // `prepareStep` behind compaction, steering and background injection —
      // all of which silently no-op without it.
      ...chat.toStreamTextOptions({ tools }),
      model: anthropic("claude-sonnet-5"),
      // `instructions`, not the deprecated `system`. Passed here rather than
      // through `chat.prompt.set()` because the prompt is static — there is no
      // per-chat or dashboard-versioned part of it to resolve in a hook.
      instructions: gameInstructions,
      messages,
      // Fires on stop and on cancel. Without it, Stop only updates the UI.
      abortSignal: signal,
      // A turn is a read-edit-read loop over the game's files, so it needs
      // room for many steps; the default of one would stop the turn dead
      // after the first tool call, before the model has said anything.
      stopWhen: stepCountIs(48),
    }),
})
