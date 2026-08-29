"use client"

import { useState, useTransition } from "react"

import { ChatComposer } from "@/components/chat-composer"
import { createGame } from "@/lib/games/actions"

/**
 * Client boundary for the home page composer: a Server Component cannot hand
 * `ChatComposer` its `onValueChange`/`onSubmit` callbacks, so the prompt state
 * and the `createGame` call live here.
 */
export function NewGameComposer() {
  const [prompt, setPrompt] = useState("")
  const [isPending, startTransition] = useTransition()

  function handleSubmit(value: string) {
    startTransition(async () => {
      await createGame(value)
      setPrompt("")
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
