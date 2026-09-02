"use client"

import { useState, useTransition } from "react"

import { ChatComposer } from "@/components/chat-composer"
import { createGame } from "@/lib/games/actions"
import {
  DEFAULT_GAME_MODEL_ID,
  type GameModelId,
} from "@/lib/games/model-catalog"

/**
 * Client boundary for the home page composer: a Server Component cannot hand
 * `ChatComposer` its `onValueChange`/`onSubmit` callbacks, so the prompt state
 * and the `createGame` call live here.
 *
 * `createGame` redirects to the new game, so the prompt is left in place — it
 * is only still on screen if the create failed. The same is true of the model:
 * the pick is state here and an argument to `createGame`, which carries it to
 * the thread — this component never sees the game it opens.
 */
export function NewGameComposer() {
  const [prompt, setPrompt] = useState("")
  const [modelId, setModelId] = useState<GameModelId>(DEFAULT_GAME_MODEL_ID)
  const [isPending, startTransition] = useTransition()

  function handleSubmit(value: string) {
    startTransition(async () => {
      await createGame(value, modelId)
    })
  }

  return (
    <ChatComposer
      value={prompt}
      onValueChange={setPrompt}
      onSubmit={handleSubmit}
      modelId={modelId}
      onModelChange={setModelId}
      disabled={isPending}
    />
  )
}
