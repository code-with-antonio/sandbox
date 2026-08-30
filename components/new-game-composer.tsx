"use client"

import { useState, useTransition } from "react"

import { ChatComposer } from "@/components/chat-composer"
import { createGame } from "@/lib/games/actions"

/**
 * Client boundary for the home page composer: a Server Component cannot hand
 * `ChatComposer` its `onValueChange`/`onSubmit` callbacks, so the prompt state
 * and the `createGame` call live here.
 *
 * `createGame` redirects to the new game, so the prompt is left in place — it
 * is only still on screen if the create failed.
 */
export function NewGameComposer() {
  const [prompt, setPrompt] = useState("")
  const [isPending, startTransition] = useTransition()

  function handleSubmit(value: string) {
    startTransition(async () => {
      await createGame(value)
    })
  }

  return (
    <ChatComposer
      value={prompt}
      onValueChange={setPrompt}
      onSubmit={handleSubmit}
      disabled={isPending}
    />
  )
}
