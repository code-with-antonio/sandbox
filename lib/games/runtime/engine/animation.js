import * as THREE from "three"

import { clamp01, ease } from "./math.js"

/**
 * Motion that isn't the game loop: tweens, springs, shakes, hit flashes, and
 * the machinery for playing clips off a loaded model.
 *
 * The reason to reach for these rather than writing `mesh.position.y += 0.1` is
 * that everything here is expressed in seconds and eased. A pickup that pops
 * over 0.3s with `outBack` reads as designed; the same pickup moved a fixed
 * amount per frame reads as a bug on a 144Hz monitor.
 */

/**
 * The tween manager. One per game; hook it to the engine and forget it.
 *
 *   const tweens = createTweens(engine)
 *   tweens.to(chest.position, { y: 2 }, { duration: 0.4, ease: ease.outBack })
 */
export function createTweens(engine = null) {
  const active = new Set()

  function step(dt) {
    for (const tween of active) {
      tween.elapsed += dt
      if (tween.elapsed < tween.delay) continue

      const t = clamp01((tween.elapsed - tween.delay) / tween.duration)
      const eased = tween.ease(t)
      // The final frame assigns the destination outright rather than
      // interpolating to it. Easing curves are floating-point arithmetic and
      // several of them — `outBack` and `outBounce` especially — come back a
      // hair off 1 at t=1, which would leave a tween resting at 9.99999 and
      // any `position.x === 10` check in the game quietly false forever.
      const done = t >= 1

      for (const key of tween.keys) {
        const { from, to } = tween.values[key]
        // Colours and vectors interpolate componentwise; plain numbers don't.
        if (typeof to === "number") {
          tween.target[key] = done ? to : from + (to - from) * eased
        } else if (to.isColor || to.isVector3 || to.isVector2) {
          if (done) tween.target[key].copy(to)
          else tween.target[key].copy(from).lerp(to, eased)
        }
      }

      tween.onUpdate?.(eased, tween.target)

      if (done) {
        active.delete(tween)
        tween.onComplete?.(tween.target)
        tween.resolve?.(tween.target)
      }
    }
  }

  const manager = {
    /**
     * Animates properties of `target` to `props`. Returns a promise that
     * settles when it lands, so sequences read as `await` rather than nested
     * callbacks.
     */
    to(target, props, options = {}) {
      const {
        duration = 0.3,
        delay = 0,
        ease: curve = ease.outCubic,
        onUpdate,
        onComplete,
      } = options

      const values = {}
      for (const [key, to] of Object.entries(props)) {
        const current = target[key]
        values[key] =
          typeof to === "number"
            ? { from: current, to }
            : { from: current.clone(), to: to.clone ? to.clone() : to }
      }

      const tween = {
        target,
        values,
        keys: Object.keys(values),
        duration: Math.max(duration, 1e-6),
        delay,
        ease: curve,
        elapsed: 0,
        onUpdate,
        onComplete,
      }
      active.add(tween)

      const promise = new Promise((resolve) => {
        tween.resolve = resolve
      })
      promise.stop = () => active.delete(tween)
      return promise
    },

    /** Starts at `props` and animates to where the target already is. */
    from(target, props, options = {}) {
      const destination = {}
      for (const key of Object.keys(props)) {
        const current = target[key]
        destination[key] =
          typeof current === "number" ? current : current.clone()
        target[key] = props[key]
      }
      return manager.to(target, destination, options)
    },

    /** A tween of a bare number, reported through `onUpdate`. For anything
     *  that isn't a property — a shader uniform, a HUD value, a volume. */
    value(from, to, options = {}) {
      return manager.to({ v: from }, { v: to }, options)
    },

    /** `await tweens.wait(0.5)` — a pause that respects the engine's timeScale
     *  and stops when the game is paused, which `setTimeout` does not. */
    wait(seconds) {
      return manager.value(0, 1, { duration: seconds, ease: ease.linear })
    },

    stopAll() {
      active.clear()
    },

    step,
  }

  if (engine) engine.onUpdate(step)
  return manager
}

/**
 * A spring: chases a target with overshoot and settle rather than easing.
 *
 * Use it where the destination keeps changing — a camera zoom that follows
 * speed, a UI element tracking a value, a weapon that kicks. A tween has to be
 * restarted when the target moves; a spring just keeps going.
 */
export class Spring {
  constructor(options = {}) {
    const { stiffness = 180, damping = 18, value = 0 } = options
    this.stiffness = stiffness
    this.damping = damping
    this.value = value
    this.target = value
    this.velocity = 0
  }

  /** Kicks the spring without moving its target — recoil, impact, a bump. */
  impulse(amount) {
    this.velocity += amount
    return this
  }

  update(dt) {
    // Sub-stepped: a stiff spring integrated over a whole slow frame goes
    // unstable and explodes, which looks like the object teleporting.
    const steps = Math.max(1, Math.ceil(dt * 120))
    const h = dt / steps
    for (let i = 0; i < steps; i++) {
      const force =
        -this.stiffness * (this.value - this.target) -
        this.damping * this.velocity
      this.velocity += force * h
      this.value += this.velocity * h
    }
    return this.value
  }
}

/** Three springs in a trenchcoat, for positions and scales. */
export class SpringVec3 {
  constructor(options = {}) {
    this.x = new Spring(options)
    this.y = new Spring(options)
    this.z = new Spring(options)
  }

  setTarget(vector) {
    this.x.target = vector.x
    this.y.target = vector.y
    this.z.target = vector.z
    return this
  }

  update(dt, out = new THREE.Vector3()) {
    return out.set(this.x.update(dt), this.y.update(dt), this.z.update(dt))
  }
}

/**
 * Screen shake as a decaying offset, applied to any object.
 *
 * Shake is the cheapest way to give an impact weight, and the easiest thing to
 * overdo — 0.15 for a footstep-scale event, 0.5 for an explosion, and it should
 * always be over inside half a second.
 */
export function createShake(object, options = {}) {
  const { decay = 5, frequency = 30 } = options
  const base = object.position.clone()
  let amount = 0
  let time = 0

  return {
    add(strength = 0.3) {
      amount = Math.max(amount, strength)
    },
    /** Call each frame, after whatever else moves the object. */
    update(dt) {
      if (amount <= 0.0001) return
      time += dt * frequency
      // Sine at offset frequencies rather than random per frame: random reads
      // as noise, this reads as a rattle.
      object.position.x += Math.sin(time * 1.7) * amount
      object.position.y += Math.sin(time * 2.3 + 1.7) * amount
      object.position.z += Math.sin(time * 1.1 + 3.4) * amount * 0.5
      amount *= Math.exp(-decay * dt)
    },
    reset() {
      amount = 0
      object.position.copy(base)
    },
  }
}

/**
 * Flashes a mesh's emissive colour and returns it. The universal "that hit".
 *
 * Without a hit flash, damage in a 3D game is invisible — the player fires,
 * the enemy's health drops, and nothing on screen says the two are connected.
 */
export function flash(object, options = {}) {
  const { color = "#ffffff", duration = 0.12, intensity = 1 } = options
  const targets = []
  object.traverse((child) => {
    if (!child.isMesh || !child.material?.emissive) return
    targets.push({
      material: child.material,
      color: child.material.emissive.clone(),
      intensity: child.material.emissiveIntensity,
    })
    child.material.emissive.set(color)
    child.material.emissiveIntensity = intensity
  })

  setTimeout(() => {
    for (const entry of targets) {
      entry.material.emissive.copy(entry.color)
      entry.material.emissiveIntensity = entry.intensity
    }
  }, duration * 1000)

  return object
}

/** A squash-and-stretch pop. Landings, pickups, buttons, anything that lands. */
export function pop(object, tweens, options = {}) {
  const { scale = 1.25, duration = 0.24 } = options
  const base = object.scale.clone()
  object.scale.set(base.x * scale, base.y / scale, base.z * scale)
  return tweens.to(
    object.scale,
    { x: base.x, y: base.y, z: base.z },
    {
      duration,
      ease: ease.outElastic,
    }
  )
}

/** Idle motion, so nothing in the scene is ever perfectly still. */
export function hover(object, options = {}) {
  const {
    amplitude = 0.15,
    speed = 2,
    spin = 0.6,
    phase = Math.random() * 10,
  } = options
  const baseY = object.position.y
  return (dt, elapsed) => {
    object.position.y = baseY + Math.sin((elapsed + phase) * speed) * amplitude
    object.rotation.y += spin * dt
  }
}

/**
 * Plays clips from a loaded GLTF, by name, with crossfades.
 *
 * Switching animation with `.stop()` then `.play()` snaps between poses; a
 * crossfade is what makes idle-to-run look like the same character.
 */
export function createMixer(model, clips, engine = null) {
  const mixer = new THREE.AnimationMixer(model)
  const actions = new Map()
  let current = null

  for (const clip of clips ?? []) {
    actions.set(clip.name, mixer.clipAction(clip))
  }

  const api = {
    mixer,
    actions,
    get playing() {
      return current
    },
    names: () => [...actions.keys()],

    play(name, options = {}) {
      const { fade = 0.25, loop = true, speed = 1 } = options
      const next = actions.get(name)
      if (!next || next === actions.get(current)) return api

      next.reset()
      next.timeScale = speed
      next.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity)
      // Holds the final pose instead of snapping back to frame zero, which is
      // what a death or a landing animation needs.
      next.clampWhenFinished = !loop

      const previous = actions.get(current)
      if (previous && fade > 0) previous.crossFadeTo(next, fade, true)
      next.play()
      current = name
      return api
    },

    stop(name) {
      actions.get(name ?? current)?.fadeOut(0.2)
      if (!name || name === current) current = null
    },

    update: (dt) => mixer.update(dt),
    dispose: () => mixer.stopAllAction(),
  }

  if (engine) engine.onUpdate(api.update)
  return api
}

// Re-exported so a game animating things needs one import, not two.
export { ease }
