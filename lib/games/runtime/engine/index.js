/**
 * The game toolkit, in one import.
 *
 *   import { createGame, models, lights } from "./engine/index.js"
 *
 * Two ways in. `createGame()` wires up everything a game always needs — a
 * renderer, a loop, input, a HUD, sound and tweens — in one call, and is where
 * a new game should start. Or import the pieces individually and assemble them
 * yourself; nothing here depends on `createGame` existing.
 *
 * Modules are grouped as namespaces (`models.tree()`, `lights.sunset()`) so
 * names stay short without colliding, with the things you reach for constantly
 * also exported flat.
 */

import { createEngine } from "./engine.js"
import { createInput } from "./input.js"
import { createHud } from "./hud.js"
import { createAudio } from "./sound.js"
import { createTweens } from "./animation.js"

export * as math from "./math.js"
export * as models from "./models.js"
export * as materials from "./materials.js"
export * as lights from "./lighting.js"
export * as effects from "./particles.js"
export * as anim from "./animation.js"
export * as debug from "./debug.js"

export { createEngine, disposeObject } from "./engine.js"
export { createInput } from "./input.js"
export { createHud } from "./hud.js"
export { createAudio } from "./sound.js"
export { createPhysics, hits, inside } from "./physics.js"
export { createPostFX } from "./postfx.js"

export {
  createTweens,
  createMixer,
  createShake,
  Spring,
  SpringVec3,
  flash,
  pop,
  hover,
  ease,
} from "./animation.js"

export {
  createParticles,
  createTrail,
  createAmbience,
  shockwave,
} from "./particles.js"

export {
  createStateMachine,
  createScore,
  createStorage,
  createTimer,
  createTicker,
  createCooldown,
  createDifficulty,
  createEvents,
  formatTime,
} from "./state.js"

export {
  orbitCamera,
  followCamera,
  topDownCamera,
  sideCamera,
  firstPerson,
  thirdPerson,
  platformer,
  pointerOnGround,
  pointerPicker,
} from "./controls.js"

export { palette, brand } from "./materials.js"

/**
 * Everything a game needs, started and ready.
 *
 * The returned object is deliberately flat, because these five things are
 * referenced constantly and `game.engine.scene` reads worse than `game.scene`
 * a hundred times over.
 *
 *   const game = createGame({ background: "#0b1020" })
 *   lights.daylight(game.scene)
 *   game.scene.add(models.ground(60))
 *   game.onUpdate((dt) => { ... })
 *
 * The loop is already running when this returns — there is nothing to start,
 * and no reason for a game to open on a still frame.
 */
export function createGame(options = {}) {
  const { actions, hud: hudOptions = {}, ...engineOptions } = options

  const engine = createEngine(engineOptions)
  const input = createInput({ engine, actions })
  const hud = createHud({ container: engine.container, ...hudOptions })
  const audio = createAudio()
  const tweens = createTweens(engine)

  engine.start()

  return {
    engine,
    input,
    hud,
    audio,
    tweens,
    scene: engine.scene,
    camera: engine.camera,
    renderer: engine.renderer,
    onUpdate: engine.onUpdate,
    onLateUpdate: engine.onLateUpdate,
    onResize: engine.onResize,
    add: engine.add,
    remove: engine.remove,
  }
}
