"use client"

import { ArrowUpIcon, SquareIcon } from "lucide-react"

import { ModelPicker } from "@/components/model-picker"
import { Button } from "@/components/ui/button"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupTextarea,
} from "@/components/ui/input-group"
import type { GameModelId } from "@/lib/games/model-catalog"

export function ChatComposer({
  value,
  onValueChange,
  onSubmit,
  onStop,
  modelId,
  onModelChange,
  streaming = false,
  disabled = false,
  placeholder = "Describe the game you want to build…",
}: {
  value: string
  onValueChange: (value: string) => void
  /** Receives the trimmed prompt; only called when it is non-empty. */
  onSubmit: (value: string) => void
  /** Cancels the turn in flight. Required for the button to offer a stop. */
  onStop?: () => void
  /** The model the next turn runs on, and the way to change it. */
  modelId: GameModelId
  onModelChange: (modelId: GameModelId) => void
  /** A turn is in flight, so the submit button becomes a stop button. */
  streaming?: boolean
  disabled?: boolean
  placeholder?: string
}) {
  const prompt = value.trim()
  const canSubmit = prompt.length > 0 && !disabled
  // Stop replaces send rather than sitting beside it, so the one button in the
  // corner always drives the turn: start it, then end it.
  const canStop = streaming && Boolean(onStop)

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!canSubmit) {
      return
    }

    onSubmit(prompt)
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends, Shift+Enter keeps the newline.
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault()
      event.currentTarget.form?.requestSubmit()
    }
  }

  return (
    <form onSubmit={handleSubmit} className="w-full">
      <InputGroup className="bg-popover">
        <InputGroupTextarea
          name="prompt"
          value={value}
          onChange={(event) => onValueChange(event.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          placeholder={placeholder}
          rows={1}
          className="field-sizing-content max-h-48 min-h-10"
        />
        <InputGroupAddon align="block-end">
          <ModelPicker modelId={modelId} onModelChange={onModelChange} />
          {/* Base UI buttons default to `type="button"`, so only send opts in. */}
          {canStop ? (
            <Button
              size="icon-lg"
              onClick={onStop}
              aria-label="Stop generating"
              className="ml-auto rounded-full"
            >
              <SquareIcon className="fill-current" />
            </Button>
          ) : (
            <Button
              type="submit"
              size="icon-lg"
              disabled={!canSubmit}
              aria-label="Send message"
              className="ml-auto rounded-full"
            >
              <ArrowUpIcon />
            </Button>
          )}
        </InputGroupAddon>
      </InputGroup>
    </form>
  )
}
