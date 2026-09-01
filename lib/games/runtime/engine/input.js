import * as THREE from "three"

import { deadzone } from "./math.js"

/**
 * Keyboard, mouse, touch and gamepad behind one per-frame snapshot.
 *
 * Games ask questions ("is the player holding left?", "did they just jump?"),
 * they don't want events. Listening directly to keydown loses the difference
 * between held and just-pressed, and repeats at the OS key-repeat rate, which
 * is why a jump wired to keydown either double-jumps or feels sticky.
 *
 *   const input = createInput({ engine, actions: { jump: ["Space", "KeyW"] } })
 *   if (input.pressed("jump")) player.jump()
 *   player.x += input.move.x * speed * dt
 *
 * Pass `engine` and the frame bookkeeping happens on its own. Without one, call
 * `input.endFrame()` yourself after your update, or `pressed` never clears.
 */

const DEFAULT_ACTIONS = {
  left: ["KeyA", "ArrowLeft"],
  right: ["KeyD", "ArrowRight"],
  up: ["KeyW", "ArrowUp"],
  down: ["KeyS", "ArrowDown"],
  jump: ["Space"],
  fire: ["Mouse0", "Enter"],
  sprint: ["ShiftLeft", "ShiftRight"],
  crouch: ["ControlLeft", "KeyC"],
  pause: ["Escape", "KeyP"],
  restart: ["KeyR"],
}

export function createInput(options = {}) {
  const {
    engine = null,
    target = window,
    element = engine?.canvas ?? document.body,
    actions = {},
    // A phone has no keyboard, so one appears on screen unless told not to.
    touchStick = true,
  } = options

  const bindings = { ...DEFAULT_ACTIONS, ...actions }

  const held = new Set()
  const justPressed = new Set()
  const justReleased = new Set()

  const input = {
    /** Left stick as a normalised -1..1 vector. WASD, arrows, stick or thumb. */
    move: new THREE.Vector2(),
    /** Mouse/touch travel since the last frame. Pointer-lock look uses this. */
    look: new THREE.Vector2(),
    /** Pointer in -1..1 clip space, ready for `raycaster.setFromCamera`. */
    pointer: new THREE.Vector2(),
    /** Pointer in css pixels within the canvas, for placing DOM over the world. */
    pointerPixels: new THREE.Vector2(),
    wheel: 0,
    pointerDown: false,
    locked: false,
    touch: matchMedia?.("(pointer: coarse)").matches ?? false,
    gamepadIndex: null,
  }

  // --- Queries --------------------------------------------------------------

  const codesFor = (name) => bindings[name] ?? [name]

  /** True for every frame the control is held. */
  input.down = (name) => codesFor(name).some((code) => held.has(code))
  /** True on the single frame it went down — jumps, shots, menu choices. */
  input.pressed = (name) => codesFor(name).some((code) => justPressed.has(code))
  /** True on the single frame it came up — charge shots, hold-to-aim. */
  input.released = (name) =>
    codesFor(name).some((code) => justReleased.has(code))
  /** -1, 0 or 1 from a pair of controls, for stepwise movement. */
  input.axis = (negative, positive) =>
    (input.down(positive) ? 1 : 0) - (input.down(negative) ? 1 : 0)
  /** Adds or replaces a binding at runtime: `input.bind("dash", ["KeyQ"])`. */
  input.bind = (name, codes) => {
    bindings[name] = codes
  }
  /** The codes an action currently listens for, for extending a binding. */
  input.codes = (name) => bindings[name]

  // Synthetic input, so on-screen touch buttons, a tutorial demo or a replay
  // all arrive through the same queries the keyboard does — the game never
  // grows a second code path for "but on a phone".
  input.press = (code) => {
    if (!held.has(code)) justPressed.add(code)
    held.add(code)
  }
  input.release = (code) => {
    held.delete(code)
    justReleased.add(code)
  }

  // --- Keyboard -------------------------------------------------------------

  function onKeyDown(event) {
    // The browser scrolls the page on space and arrows, which drags the game
    // out of view mid-jump. The game owns these keys.
    if (
      ["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(
        event.code
      )
    ) {
      event.preventDefault()
    }
    // `repeat` is the OS firing the key again while it is held; the held set
    // already covers that, and letting it through would re-fire `pressed`.
    if (event.repeat) return
    if (!held.has(event.code)) justPressed.add(event.code)
    held.add(event.code)
  }

  function onKeyUp(event) {
    held.delete(event.code)
    justReleased.add(event.code)
  }

  // Alt-tab and window-switching swallow the keyup, leaving a key stuck down
  // forever — the classic "my character keeps running" bug.
  function onBlur() {
    for (const code of held) justReleased.add(code)
    held.clear()
  }

  target.addEventListener("keydown", onKeyDown)
  target.addEventListener("keyup", onKeyUp)
  window.addEventListener("blur", onBlur)

  // --- Pointer --------------------------------------------------------------

  function updatePointer(event) {
    const rect = element.getBoundingClientRect()
    input.pointerPixels.set(event.clientX - rect.left, event.clientY - rect.top)
    input.pointer.set(
      (input.pointerPixels.x / rect.width) * 2 - 1,
      -(input.pointerPixels.y / rect.height) * 2 + 1
    )
  }

  function onPointerDown(event) {
    updatePointer(event)
    const code = `Mouse${event.button}`
    if (!held.has(code)) justPressed.add(code)
    held.add(code)
    input.pointerDown = true
    element.setPointerCapture?.(event.pointerId)
  }

  function onPointerUp(event) {
    const code = `Mouse${event.button}`
    held.delete(code)
    justReleased.add(code)
    input.pointerDown = held.has("Mouse0")
    element.releasePointerCapture?.(event.pointerId)
  }

  function onPointerMove(event) {
    updatePointer(event)
    // movementX/Y is the only source that keeps working under pointer lock,
    // where clientX stops moving.
    input.look.x += event.movementX ?? 0
    input.look.y += event.movementY ?? 0
  }

  function onWheel(event) {
    event.preventDefault()
    input.wheel += Math.sign(event.deltaY)
  }

  function onContextMenu(event) {
    // Right mouse is a game button here, not a menu.
    event.preventDefault()
  }

  element.addEventListener("pointerdown", onPointerDown)
  element.addEventListener("pointerup", onPointerUp)
  element.addEventListener("pointermove", onPointerMove)
  element.addEventListener("pointercancel", onPointerUp)
  element.addEventListener("wheel", onWheel, { passive: false })
  element.addEventListener("contextmenu", onContextMenu)

  function onLockChange() {
    input.locked = document.pointerLockElement === element
  }
  document.addEventListener("pointerlockchange", onLockChange)

  /** Hides the cursor and gives unbounded mouse look. Needs a click to allow. */
  input.requestPointerLock = () => element.requestPointerLock?.()
  input.exitPointerLock = () => document.exitPointerLock?.()

  // --- Touch stick ----------------------------------------------------------

  // A thumb drag anywhere on the left half steers; the right half is the
  // look/fire side. No on-screen furniture, so it costs nothing on desktop.
  const stick = { active: false, id: null, originX: 0, originY: 0, x: 0, y: 0 }
  const STICK_RADIUS = 64

  function onTouchStart(event) {
    if (!touchStick) return
    for (const touch of event.changedTouches) {
      if (stick.active) break
      const rect = element.getBoundingClientRect()
      if (touch.clientX - rect.left > rect.width / 2) continue
      stick.active = true
      stick.id = touch.identifier
      stick.originX = touch.clientX
      stick.originY = touch.clientY
    }
  }

  function onTouchMove(event) {
    if (!stick.active) return
    for (const touch of event.changedTouches) {
      if (touch.identifier !== stick.id) continue
      stick.x = Math.max(
        -1,
        Math.min(1, (touch.clientX - stick.originX) / STICK_RADIUS)
      )
      stick.y = Math.max(
        -1,
        Math.min(1, (touch.clientY - stick.originY) / STICK_RADIUS)
      )
    }
  }

  function onTouchEnd(event) {
    for (const touch of event.changedTouches) {
      if (touch.identifier !== stick.id) continue
      stick.active = false
      stick.id = null
      stick.x = 0
      stick.y = 0
    }
  }

  if (touchStick) {
    element.addEventListener("touchstart", onTouchStart, { passive: true })
    element.addEventListener("touchmove", onTouchMove, { passive: true })
    element.addEventListener("touchend", onTouchEnd)
    element.addEventListener("touchcancel", onTouchEnd)
  }

  // --- Gamepad --------------------------------------------------------------

  // Gamepads have no events for button state, only a polled snapshot, so this
  // reads them once per frame and folds them into the same sets as everything
  // else — a game never has to ask which device the player is on.
  const PAD_BUTTONS = {
    0: "jump",
    1: "crouch",
    2: "fire",
    3: "restart",
    9: "pause",
    12: "up",
    13: "down",
    14: "left",
    15: "right",
  }
  const padHeld = new Set()

  function pollGamepad() {
    const pads = navigator.getGamepads?.() ?? []
    const pad = pads.find((p) => p && p.connected)
    input.gamepadIndex = pad ? pad.index : null
    if (!pad) return { x: 0, y: 0 }

    for (const [index, action] of Object.entries(PAD_BUTTONS)) {
      const code = `Pad${index}`
      const pressed = pad.buttons[index]?.pressed
      if (pressed && !padHeld.has(code)) {
        padHeld.add(code)
        held.add(code)
        justPressed.add(code)
        for (const bound of codesFor(action)) justPressed.add(bound)
        held.add(codesFor(action)[0])
      } else if (!pressed && padHeld.has(code)) {
        padHeld.delete(code)
        held.delete(code)
        held.delete(codesFor(action)[0])
        justReleased.add(code)
      }
    }

    // Right stick is look, at a rate that matches a mouse's pixels-per-frame.
    input.look.x += deadzone(pad.axes[2] ?? 0) * 12
    input.look.y += deadzone(pad.axes[3] ?? 0) * 12

    return { x: deadzone(pad.axes[0] ?? 0), y: deadzone(pad.axes[1] ?? 0) }
  }

  // --- Frame ----------------------------------------------------------------

  function beginFrame() {
    const pad = pollGamepad()
    const keyX = input.axis("left", "right")
    const keyY = input.axis("up", "down")

    // Whichever source is actually being used wins, so a plugged-in pad resting
    // at zero never fights the keyboard.
    input.move.set(pad.x || stick.x || keyX, pad.y || stick.y || keyY)
    // Normalising stops diagonal movement being 1.41x faster than straight —
    // the oldest bug in 2D and 3D movement alike.
    if (input.move.lengthSq() > 1) input.move.normalize()
  }

  /** Clears the one-frame state. The engine calls this for you. */
  input.endFrame = () => {
    justPressed.clear()
    justReleased.clear()
    input.look.set(0, 0)
    input.wheel = 0
  }

  input.dispose = () => {
    target.removeEventListener("keydown", onKeyDown)
    target.removeEventListener("keyup", onKeyUp)
    window.removeEventListener("blur", onBlur)
    element.removeEventListener("pointerdown", onPointerDown)
    element.removeEventListener("pointerup", onPointerUp)
    element.removeEventListener("pointermove", onPointerMove)
    element.removeEventListener("pointercancel", onPointerUp)
    element.removeEventListener("wheel", onWheel)
    element.removeEventListener("contextmenu", onContextMenu)
    element.removeEventListener("touchstart", onTouchStart)
    element.removeEventListener("touchmove", onTouchMove)
    element.removeEventListener("touchend", onTouchEnd)
    element.removeEventListener("touchcancel", onTouchEnd)
    document.removeEventListener("pointerlockchange", onLockChange)
    unhook?.()
  }

  // Registered so `move` is fresh before the game's own updates run, and the
  // one-frame flags survive until every one of them has seen them.
  let unhook = null
  if (engine) {
    const offEarly = engine.onUpdate(beginFrame)
    const offLate = engine.onLateUpdate(input.endFrame)
    unhook = () => {
      offEarly()
      offLate()
    }
    // `onUpdate` appends, so this runs after any listener added earlier. Games
    // add theirs after creating input, which is the order that works.
  } else {
    input.beginFrame = beginFrame
  }

  return input
}
