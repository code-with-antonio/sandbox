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
import { describeError, elapsed, logger } from "@/lib/observability"
import { createGameTools } from "@/lib/games/tools"

const MODEL = "claude-opus-5"

// A turn is a read-edit-read loop over the game's files, so it needs room for
// many steps; the default of one would stop the turn dead after the first tool
// call, before the model has said anything.
const MAX_STEPS = 48

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
    const startedAt = performance.now()
    const stored = await loadGameMessages(chatId)

    // Appends a genuinely new user message and no-ops otherwise. A new game is
    // created with its opening prompt already stored, and the client replays
    // that same message to ask for the first reply — this dedupes it by id.
    const appended = upsertIncomingMessage(stored, {
      trigger,
      incomingMessages,
    })

    if (appended) {
      await saveGameMessages({ gameId: chatId, messages: stored })
    }

    // The top of every turn, and the one place the thread's size is visible.
    // Message *counts*, never message content: the thread is the player's
    // prompts and the agent's game source, both of which stay out of Sentry.
    //
    // `appended: false` on what should be a new turn is the signature of the
    // dedupe swallowing a real message, which would look to the player like the
    // agent replying to the message before theirs.
    logger.info(logger.fmt`Chat turn starting for game ${chatId}`, {
      "game.id": chatId,
      "chat.stored_messages": stored.length,
      "chat.incoming_messages": incomingMessages.length,
      "chat.appended_incoming": appended,
      duration_ms: elapsed(startedAt),
    })

    return stored
  },
  // Fires once per game, on the first message of its thread — so the sandbox
  // is created exactly once and is already seeded before `run` streams a reply.
  onChatStart: async ({ chatId }) => {
    try {
      await createGameSandbox(chatId)
    } catch (error) {
      // Fires exactly once per game, and everything the agent does afterwards
      // needs what it builds. Failing here doesn't stop the turn — the tools
      // fall back to creating a sandbox themselves — but it does mean the first
      // turn pays that cost mid-stream, and it is the explanation for the
      // `getGameSandbox` warning that follows.
      logger.error(
        logger.fmt`Could not create the sandbox for game ${chatId}`,
        { "game.id": chatId, ...describeError(error) }
      )

      throw error
    }
  },
  onTurnComplete: async ({
    chatId,
    uiMessages,
    chatAccessToken,
    lastEventId,
  }) => {
    const startedAt = performance.now()

    try {
      await saveGameTurn({
        gameId: chatId,
        messages: uiMessages,
        chatAccessToken,
        chatLastEventId: lastEventId,
      })
    } catch (error) {
      // The turn's work is already in the sandbox by now; this is the write
      // that makes it survive a reload. Losing it strands the thread on the
      // previous turn's cursor, which is the one failure here that the player
      // sees and the agent doesn't.
      logger.error(
        logger.fmt`Could not persist the finished turn for game ${chatId}`,
        {
          "game.id": chatId,
          "chat.messages": uiMessages.length,
          "chat.has_cursor": lastEventId !== undefined,
          ...describeError(error),
        }
      )

      throw error
    }

    // Pairs with the `Chat turn starting` log above: one of each per turn, so a
    // turn that began and never ended is a gap rather than something to infer.
    logger.info(logger.fmt`Chat turn complete for game ${chatId}`, {
      "game.id": chatId,
      "gen_ai.request.model": MODEL,
      "chat.messages": uiMessages.length,
      // A turn that ends with no cursor cannot be resumed, so a reload
      // replays it — worth being able to count.
      "chat.has_cursor": lastEventId !== undefined,
      duration_ms: elapsed(startedAt),
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
      model: anthropic(MODEL),
      // `instructions`, not the deprecated `system`. Passed here rather than
      // through `chat.prompt.set()` because the prompt is static — there is no
      // per-chat or dashboard-versioned part of it to resolve in a hook.
      instructions: gameInstructions,
      messages,
      // Fires on stop and on cancel. Without it, Stop only updates the UI.
      abortSignal: signal,
      stopWhen: stepCountIs(MAX_STEPS),
    }),
})
