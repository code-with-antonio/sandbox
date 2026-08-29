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
import { createGame } from "@/lib/games/actions"

const models = ["Kimi K3", "Claude Opus 5", "GPT-5", "Gemini 3 Pro"]

export function ChatComposer() {
  return (
    <form action={createGame} className="w-full">
      <InputGroup className="bg-popover">
        <InputGroupTextarea
          name="prompt"
          required
          placeholder="Describe the game you want to build…"
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
          <Button type="submit" size="icon-lg" className="ml-auto rounded-full">
            <ArrowUpIcon />
          </Button>
        </InputGroupAddon>
      </InputGroup>
    </form>
  )
}
