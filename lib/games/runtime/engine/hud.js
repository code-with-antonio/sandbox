import * as THREE from "three"

import { brand } from "./materials.js"

/**
 * The layer of DOM over the canvas: score, health, timers, menus, messages.
 *
 * HUDs are DOM, not 3D. Text drawn into the scene fights the camera, blurs at
 * distance and costs a texture upload every time it changes; an absolutely
 * positioned div is sharp, free and styleable. The canvas keeps the pointer,
 * so nothing here blocks a click unless it is a button.
 *
 *   const hud = createHud()
 *   const score = hud.stat("Score", 0)
 *   score.set(120)
 *   hud.toast("Level up")
 *
 * Styles are injected once, so a game gets a HUD that already looks finished.
 */

const STYLE_ID = "engine-hud-style"

const CSS = `
.hud {
  position: absolute;
  inset: 0;
  /* The HUD is a window onto the game, not a wall in front of it: clicks fall
     through to the canvas unless a child opts back in. */
  pointer-events: none;
  display: grid;
  grid-template-columns: auto 1fr auto;
  grid-template-rows: auto 1fr auto;
  /* Notched phones: nothing in the HUD sits under the hardware. */
  padding:
    calc(clamp(12px, 2.5vmin, 28px) + env(safe-area-inset-top))
    calc(clamp(12px, 2.5vmin, 28px) + env(safe-area-inset-right))
    calc(clamp(12px, 2.5vmin, 28px) + env(safe-area-inset-bottom))
    calc(clamp(12px, 2.5vmin, 28px) + env(safe-area-inset-left));
  gap: 12px;
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif;
  color: #ededed;
  /* Above the canvas, below nothing. */
  z-index: 10;
  user-select: none;
  -webkit-user-select: none;
}
.hud-corner { display: flex; flex-direction: column; gap: 8px; }
.hud-corner[data-corner="top-left"] { grid-area: 1 / 1; align-items: flex-start; }
.hud-corner[data-corner="top-center"] { grid-area: 1 / 2; align-items: center; }
.hud-corner[data-corner="top-right"] { grid-area: 1 / 3; align-items: flex-end; }
.hud-corner[data-corner="center"] { grid-area: 2 / 2; align-items: center; justify-content: center; }
.hud-corner[data-corner="bottom-left"] { grid-area: 3 / 1; align-items: flex-start; justify-content: flex-end; }
.hud-corner[data-corner="bottom-center"] { grid-area: 3 / 2; align-items: center; justify-content: flex-end; }
.hud-corner[data-corner="bottom-right"] { grid-area: 3 / 3; align-items: flex-end; justify-content: flex-end; }

.hud-stat {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 6px 12px;
  border-radius: 10px;
  background: rgba(10, 10, 10, 0.55);
  border: 1px solid rgba(255, 255, 255, 0.08);
  backdrop-filter: blur(8px);
  font-variant-numeric: tabular-nums;
}
.hud-stat-label {
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #a1a1a1;
}
.hud-stat-value { font-size: 20px; font-weight: 650; }
.hud-stat.is-bumped { animation: hud-bump 260ms ease-out; }
@keyframes hud-bump {
  0% { transform: scale(1); }
  35% { transform: scale(1.16); color: ${brand.amber}; }
  100% { transform: scale(1); }
}

.hud-bar {
  width: clamp(120px, 22vw, 240px);
  padding: 6px 10px;
  border-radius: 10px;
  background: rgba(10, 10, 10, 0.55);
  border: 1px solid rgba(255, 255, 255, 0.08);
  backdrop-filter: blur(8px);
}
.hud-bar-label {
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #a1a1a1;
  margin-bottom: 5px;
}
.hud-bar-track {
  height: 8px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.1);
  overflow: hidden;
}
.hud-bar-fill {
  height: 100%;
  border-radius: 999px;
  background: ${brand.ember};
  transition: width 180ms ease-out, background-color 240ms ease-out;
}

.hud-text { font-size: 14px; color: #a1a1a1; text-shadow: 0 1px 2px rgba(0,0,0,0.6); }

.hud-toast {
  padding: 8px 16px;
  border-radius: 999px;
  background: rgba(10, 10, 10, 0.75);
  border: 1px solid rgba(255, 255, 255, 0.1);
  font-size: 14px;
  font-weight: 600;
  animation: hud-toast 2.4s ease-out forwards;
}
@keyframes hud-toast {
  0% { opacity: 0; transform: translateY(8px); }
  12%, 72% { opacity: 1; transform: translateY(0); }
  100% { opacity: 0; transform: translateY(-10px); }
}

.hud-banner {
  font-size: clamp(28px, 7vmin, 64px);
  font-weight: 800;
  letter-spacing: -0.02em;
  text-shadow: 0 4px 24px rgba(0, 0, 0, 0.6);
  animation: hud-banner 1.4s ease-out forwards;
}
@keyframes hud-banner {
  0% { opacity: 0; transform: scale(0.86); }
  18% { opacity: 1; transform: scale(1.04); }
  70% { opacity: 1; transform: scale(1); }
  100% { opacity: 0; transform: scale(1.02); }
}

.hud-overlay {
  position: absolute;
  inset: 0;
  z-index: 20;
  display: grid;
  place-items: center;
  gap: 16px;
  padding: 24px;
  text-align: center;
  background: radial-gradient(circle at 50% 45%, rgba(10,10,10,0.72), rgba(10,10,10,0.94));
  backdrop-filter: blur(3px);
  pointer-events: auto;
  animation: hud-fade 240ms ease-out;
}
@keyframes hud-fade { from { opacity: 0; } to { opacity: 1; } }
.hud-overlay-inner { display: grid; gap: 12px; justify-items: center; }
.hud-overlay h2 {
  margin: 0;
  font-size: clamp(28px, 6vmin, 52px);
  font-weight: 800;
  letter-spacing: -0.02em;
}
.hud-overlay p { margin: 0; color: #a1a1a1; font-size: 15px; max-width: 42ch; line-height: 1.5; }

.hud-button {
  pointer-events: auto;
  padding: 10px 22px;
  border: 0;
  border-radius: 999px;
  background: ${brand.ember};
  color: #fff;
  font: inherit;
  font-size: 15px;
  font-weight: 650;
  cursor: pointer;
  transition: transform 120ms ease-out, filter 120ms ease-out;
}
.hud-button:hover { filter: brightness(1.1); transform: translateY(-1px); }
.hud-button:active { transform: translateY(1px) scale(0.98); }
.hud-button[data-variant="ghost"] {
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.12);
}

.hud-crosshair {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 18px;
  height: 18px;
  transform: translate(-50%, -50%);
  opacity: 0.8;
}
.hud-crosshair::before, .hud-crosshair::after {
  content: "";
  position: absolute;
  background: #fff;
  box-shadow: 0 0 3px rgba(0,0,0,0.9);
}
.hud-crosshair::before { left: 50%; top: 0; width: 2px; height: 100%; margin-left: -1px; }
.hud-crosshair::after { top: 50%; left: 0; height: 2px; width: 100%; margin-top: -1px; }

.hud-keys {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  justify-content: center;
  font-size: 12px;
  color: #a1a1a1;
}
.hud-keys kbd {
  padding: 3px 7px;
  border-radius: 6px;
  background: rgba(255,255,255,0.08);
  border: 1px solid rgba(255,255,255,0.12);
  border-bottom-width: 2px;
  font: inherit;
  font-size: 11px;
  color: #ededed;
}

.hud-touch {
  pointer-events: auto;
  width: 68px;
  height: 68px;
  border-radius: 50%;
  border: 1px solid rgba(255,255,255,0.18);
  background: rgba(255,255,255,0.12);
  color: #fff;
  font: inherit;
  font-weight: 700;
  backdrop-filter: blur(6px);
}
.hud-touch:active { background: rgba(255,255,255,0.28); }

.hud-flash {
  position: absolute;
  inset: 0;
  pointer-events: none;
  opacity: 0;
  z-index: 15;
}
`

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement("style")
  style.id = STYLE_ID
  style.textContent = CSS
  document.head.appendChild(style)
}

export function createHud(options = {}) {
  const { container = document.body } = options
  ensureStyles()

  const root = document.createElement("div")
  root.className = "hud"
  container.appendChild(root)

  const corners = new Map()
  function corner(name) {
    let element = corners.get(name)
    if (!element) {
      element = document.createElement("div")
      element.className = "hud-corner"
      element.dataset.corner = name
      root.appendChild(element)
      corners.set(name, element)
    }
    return element
  }

  const hud = { root, corner }

  /**
   * A labelled number. Bumps when it changes, which is most of the feedback a
   * score needs — a number that silently ticks up reads as nothing happening.
   */
  hud.stat = (label, value = 0, options = {}) => {
    const { at = "top-left", format = (v) => v, bump = true } = options
    const element = document.createElement("div")
    element.className = "hud-stat"
    element.innerHTML = `<span class="hud-stat-label"></span><span class="hud-stat-value"></span>`
    const labelEl = element.querySelector(".hud-stat-label")
    const valueEl = element.querySelector(".hud-stat-value")
    labelEl.textContent = label
    valueEl.textContent = format(value)
    corner(at).appendChild(element)

    let current = value
    return {
      element,
      get value() {
        return current
      },
      set(next) {
        if (next === current) return
        current = next
        valueEl.textContent = format(next)
        if (bump) {
          // Restarting a CSS animation needs the class off for a frame.
          element.classList.remove("is-bumped")
          void element.offsetWidth
          element.classList.add("is-bumped")
        }
      },
      add(delta) {
        this.set(current + delta)
      },
      setLabel(next) {
        labelEl.textContent = next
      },
      remove: () => element.remove(),
    }
  }

  /** Health, fuel, charge, a boss's life. Goes red as it empties. */
  hud.bar = (label, options = {}) => {
    const {
      at = "top-left",
      value = 1,
      max = 1,
      color = brand.ember,
      dangerColor = "#ef4444",
      dangerBelow = 0.3,
    } = options
    const element = document.createElement("div")
    element.className = "hud-bar"
    element.innerHTML = `<div class="hud-bar-label"></div><div class="hud-bar-track"><div class="hud-bar-fill"></div></div>`
    element.querySelector(".hud-bar-label").textContent = label
    const fill = element.querySelector(".hud-bar-fill")
    corner(at).appendChild(element)

    const api = {
      element,
      max,
      set(next) {
        const ratio = Math.max(0, Math.min(1, next / api.max))
        fill.style.width = `${ratio * 100}%`
        fill.style.backgroundColor = ratio <= dangerBelow ? dangerColor : color
        return api
      },
      setLabel(next) {
        element.querySelector(".hud-bar-label").textContent = next
      },
      remove: () => element.remove(),
    }
    return api.set(value)
  }

  /** Free-form line of text. Timers, hints, coordinates. */
  hud.text = (content = "", options = {}) => {
    const { at = "bottom-left" } = options
    const element = document.createElement("div")
    element.className = "hud-text"
    element.textContent = content
    corner(at).appendChild(element)
    return {
      element,
      set: (next) => {
        element.textContent = next
      },
      remove: () => element.remove(),
    }
  }

  /** A short message that fades itself out. "+50", "Checkpoint", "Reloading". */
  hud.toast = (message, options = {}) => {
    const { at = "bottom-center", duration = 2400 } = options
    const element = document.createElement("div")
    element.className = "hud-toast"
    element.textContent = message
    corner(at).appendChild(element)
    setTimeout(() => element.remove(), duration)
    return element
  }

  /** Big centred text that punches in and clears. "WAVE 3", "GO", "PERFECT". */
  hud.banner = (message, options = {}) => {
    const { duration = 1400 } = options
    const element = document.createElement("div")
    element.className = "hud-banner"
    element.textContent = message
    corner("center").appendChild(element)
    setTimeout(() => element.remove(), duration)
    return element
  }

  /**
   * A full-screen modal — game over, pause, victory.
   *
   * Buttons are `{ label, onClick, variant }`. Returns a handle with `close()`,
   * so the game decides when it goes; nothing here auto-dismisses a decision.
   */
  hud.overlay = (options = {}) => {
    const { title = "", body = "", buttons = [], dismissible = false } = options
    const element = document.createElement("div")
    element.className = "hud-overlay"

    const inner = document.createElement("div")
    inner.className = "hud-overlay-inner"
    if (title) {
      const heading = document.createElement("h2")
      heading.textContent = title
      inner.appendChild(heading)
    }
    if (body) {
      const paragraph = document.createElement("p")
      paragraph.textContent = body
      inner.appendChild(paragraph)
    }

    const handle = {
      element,
      close: () => element.remove(),
    }

    if (buttons.length) {
      const row = document.createElement("div")
      row.style.display = "flex"
      row.style.gap = "10px"
      row.style.marginTop = "6px"
      for (const button of buttons) {
        const node = document.createElement("button")
        node.className = "hud-button"
        node.textContent = button.label
        if (button.variant) node.dataset.variant = button.variant
        node.addEventListener("click", () => {
          // Closing first means an `onClick` that opens another overlay doesn't
          // stack two on top of each other.
          if (button.keepOpen !== true) handle.close()
          button.onClick?.()
        })
        row.appendChild(node)
      }
      inner.appendChild(row)
    }

    if (dismissible) {
      element.addEventListener("click", (event) => {
        if (event.target === element) handle.close()
      })
    }

    element.appendChild(inner)
    container.appendChild(element)
    return handle
  }

  /** A standalone button, for a start screen or a mute toggle. */
  hud.button = (label, onClick, options = {}) => {
    const { at = "bottom-right", variant } = options
    const element = document.createElement("button")
    element.className = "hud-button"
    element.textContent = label
    if (variant) element.dataset.variant = variant
    element.addEventListener("click", onClick)
    corner(at).appendChild(element)
    return { element, remove: () => element.remove() }
  }

  /** Centre reticle for anything aimed. */
  hud.crosshair = () => {
    const element = document.createElement("div")
    element.className = "hud-crosshair"
    root.appendChild(element)
    return {
      element,
      show: () => (element.style.display = ""),
      hide: () => (element.style.display = "none"),
      remove: () => element.remove(),
    }
  }

  /** A row of key caps. The fastest way to teach controls without a tutorial. */
  hud.keys = (pairs, options = {}) => {
    const { at = "bottom-center" } = options
    const element = document.createElement("div")
    element.className = "hud-keys"
    element.innerHTML = Object.entries(pairs)
      .map(([key, action]) => `<span><kbd>${key}</kbd> ${action}</span>`)
      .join("")
    corner(at).appendChild(element)
    return { element, remove: () => element.remove() }
  }

  /**
   * On-screen buttons for touch. Each fires like a key, so the game's existing
   * `input.pressed("jump")` keeps working without a second code path.
   */
  hud.touchButtons = (buttons, input, options = {}) => {
    const { at = "bottom-right", onlyOnTouch = true } = options
    if (onlyOnTouch && !(matchMedia?.("(pointer: coarse)").matches ?? false)) {
      return { remove: () => {} }
    }
    const row = document.createElement("div")
    row.style.display = "flex"
    row.style.gap = "10px"
    for (const [label, action] of Object.entries(buttons)) {
      const node = document.createElement("button")
      node.className = "hud-touch"
      node.textContent = label
      // A synthetic key code, so `input.pressed("jump")` in the game keeps
      // working untouched whether the player used a thumb or a keyboard.
      const code = `Touch_${action}`
      input?.bind(action, [...(input.codes(action) ?? []), code])
      node.addEventListener("pointerdown", (event) => {
        event.preventDefault()
        input?.press(code)
      })
      node.addEventListener("pointerup", () => input?.release(code))
      node.addEventListener("pointercancel", () => input?.release(code))
      node.addEventListener("pointerleave", () => input?.release(code))
      row.appendChild(node)
    }
    corner(at).appendChild(row)
    return { element: row, remove: () => row.remove() }
  }

  /** A colour wash over the whole screen — damage red, pickup white, heal green. */
  hud.flash = (color = "#ef4444", options = {}) => {
    const { duration = 260, opacity = 0.45 } = options
    const element = document.createElement("div")
    element.className = "hud-flash"
    element.style.background = color
    container.appendChild(element)
    element.animate([{ opacity }, { opacity: 0 }], {
      duration,
      easing: "ease-out",
    }).onfinish = () => element.remove()
    return element
  }

  /**
   * Pins a DOM element to a world position — nameplates, waypoints, markers.
   * Returns `update()` to call each frame; it hides the element behind the camera.
   */
  hud.marker = (engine, target, content, options = {}) => {
    const { className = "hud-text", offsetY = 1.5 } = options
    const element = document.createElement("div")
    element.className = className
    element.style.position = "absolute"
    element.style.transform = "translate(-50%, -50%)"
    element.textContent = content
    root.appendChild(element)

    const point = new THREE.Vector3()
    return {
      element,
      set: (next) => (element.textContent = next),
      update() {
        point.copy(target.position)
        point.y += offsetY
        point.project(engine.camera)
        // z > 1 means the point is behind the camera, where projection flips.
        const behind = point.z > 1
        element.style.display = behind ? "none" : ""
        if (behind) return
        element.style.left = `${((point.x + 1) / 2) * 100}%`
        element.style.top = `${((1 - point.y) / 2) * 100}%`
      },
      remove: () => element.remove(),
    }
  }

  hud.clear = () => {
    for (const element of corners.values()) element.replaceChildren()
  }

  hud.remove = () => root.remove()

  return hud
}
