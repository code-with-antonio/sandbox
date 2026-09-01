import type { Instructions } from "ai"

import { engine } from "./engine"
import { runtime } from "./runtime"
import { workflow } from "./workflow"

/**
 * The agent's system prompt, as one system message per subject.
 *
 * Kept as separate blocks rather than one string so each stays editable on its
 * own; the Anthropic provider concatenates them into the request's system
 * field, so the model reads them as one prompt in this order — what the job is,
 * then where it is done, then what it is done with.
 *
 * `satisfies` rather than an annotation: `Instructions` also admits a bare
 * string, and the array form is what `streamText` is handed here.
 */
export const gameInstructions = [
  { role: "system", content: workflow },
  { role: "system", content: runtime },
  { role: "system", content: engine },
] satisfies Instructions
