import { anthropic } from "@ai-sdk/anthropic"
import type { LanguageModel } from "ai"

import type { GameModelId } from "./model-catalog"

/**
 * The provider instance behind each catalog entry.
 *
 * Server-side only — constructing these reaches for `ANTHROPIC_API_KEY`, and
 * the provider SDK has no business in a browser bundle. There is no
 * `server-only` marker enforcing that, though, for the same reason `@/lib/db`
 * keeps its marker in a separate entry: the chat agent imports this module and
 * runs in the Trigger.dev worker, where that marker throws. Reach for the
 * catalog instead of this file from anything a client component can touch.
 *
 * `satisfies` rather than an annotation, so the record has to cover every
 * `GameModelId` — a model added to the catalog and forgotten here is a type
 * error, not an undefined model discovered at the top of someone's turn.
 */
export const gameModels = {
  "claude-opus-5": anthropic("claude-opus-5"),
  "claude-sonnet-5": anthropic("claude-sonnet-5"),
  "claude-haiku-4-5": anthropic("claude-haiku-4-5"),
} satisfies Record<GameModelId, LanguageModel>
