"use client"

import { ArrowUpIcon, ChevronDownIcon, GripIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group"

const models = ["Kimi K3", "Claude Opus 5", "GPT-5", "Gemini 3 Pro"]

export function ChatComposer({
  value,
  onValueChange,
  onSubmit,
  disabled = false,
  placeholder = "Describe the game you want to build…",
}: {
  value: string
  onValueChange: (value: string) => void
  /** Receives the trimmed prompt; only called when it is non-empty. */
  onSubmit: (value: string) => void
  disabled?: boolean
  placeholder?: string
}) {
  const prompt = value.trim()
  const canSubmit = prompt.length > 0 && !disabled

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
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <InputGroupButton>
                  <GripIcon />
                  Kimi K3
                  <ChevronDownIcon />
                </InputGroupButton>
              }
            />
            <DropdownMenuContent className="w-auto">
              {models.map((model) => (
                <DropdownMenuItem key={model}>{model}</DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          {/* Base UI buttons default to `type="button"`. */}
          <Button
            type="submit"
            size="icon-lg"
            disabled={!canSubmit}
            className="ml-auto rounded-full"
          >
            <ArrowUpIcon />
          </Button>
        </InputGroupAddon>
      </InputGroup>
    </form>
  )
}
