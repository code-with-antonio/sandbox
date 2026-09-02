import type { GameModelId } from "./model-catalog"
import { gameModels } from "./models"

/**
 * The per-model half of a turn's `streamText` call.
 *
 * Spread into `streamText` alongside the options that don't vary with the
 * model — the instructions, the tools, the step limit. Today it resolves to
 * the provider instance and nothing more, and it is a function rather than a
 * bare lookup because the three models are not one generation: the first
 * setting that has to differ between them — thinking, effort, an output cap —
 * belongs here, next to the model it applies to, rather than as a branch in
 * the middle of the run function.
 */
export function gameModelSettings(modelId: GameModelId) {
  return { model: gameModels[modelId] }
}
