"use client"

import { ChevronDownIcon, GripIcon } from "lucide-react"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { InputGroupButton } from "@/components/ui/input-group"
import { GAME_MODELS, type GameModelId } from "@/lib/games/model-catalog"

/**
 * Which model the next turn is built with.
 *
 * Controlled, and deliberately owns nothing: the selection belongs to whoever
 * is sending the turns, because that is who has to put it on the wire. This
 * only renders the catalog and reports a pick.
 *
 * A radio group rather than plain items, so the menu says which model is
 * running as well as which are available — the check is the answer to "what am
 * I on?", which the trigger can only give in the abbreviated form of a name.
 */
export function ModelPicker({
  modelId,
  onModelChange,
}: {
  modelId: GameModelId
  onModelChange: (modelId: GameModelId) => void
}) {
  // Total in practice — `GameModelId` is derived from this same list — but not
  // provably so to the type checker, and the trigger has to render something.
  const selected = GAME_MODELS.find((model) => model.id === modelId)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <InputGroupButton>
            <GripIcon />
            {selected?.name ?? modelId}
            <ChevronDownIcon />
          </InputGroupButton>
        }
      />
      {/* Wide enough for a tagline to sit on one or two lines rather than the
          trigger's width, which is one short name. */}
      <DropdownMenuContent className="w-72">
        <DropdownMenuRadioGroup
          value={modelId}
          // The group's value is one of these ids by construction — the items
          // below are the only things that can set it — but `RadioGroup` is
          // typed for arbitrary values and can't know that.
          onValueChange={(value) => onModelChange(value as GameModelId)}
        >
          {GAME_MODELS.map((model) => (
            <DropdownMenuRadioItem
              key={model.id}
              value={model.id}
              className="py-1.5"
            >
              <div className="flex flex-col gap-0.5">
                <span className="font-medium">{model.name}</span>
                <span className="text-xs text-muted-foreground">
                  {model.tagline}
                </span>
              </div>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
