/**
 * What the game is doing, what the player has, and what survives a reload.
 *
 * The part of a game that has nothing to do with 3D, and the part most likely
 * to end up as a tangle of booleans — `isPlaying`, `isPaused`, `isGameOver`,
 * three of which can be true at once. A machine with named states can only ever
 * be in one of them.
 */

/** The smallest useful event bus. Decouples "a thing happened" from "react". */
export function createEvents() {
  const listeners = new Map()

  return {
    on(event, handler) {
      if (!listeners.has(event)) listeners.set(event, new Set())
      listeners.get(event).add(handler)
      return () => listeners.get(event)?.delete(handler)
    },
    once(event, handler) {
      const off = this.on(event, (...args) => {
        off()
        handler(...args)
      })
      return off
    },
    emit(event, ...args) {
      // Copied before iterating: a handler that unsubscribes itself would
      // otherwise mutate the set mid-loop and skip the next listener.
      for (const handler of [...(listeners.get(event) ?? [])]) handler(...args)
    },
    off(event) {
      listeners.delete(event)
    },
  }
}

/**
 * A state machine, with an update per state.
 *
 *   const game = createStateMachine({
 *     playing: { enter: () => hud.banner("GO"), update: (dt) => spawn(dt) },
 *     over:    { enter: () => showGameOver() },
 *   }, "playing")
 *
 * `game.go("over")` runs `playing.exit` then `over.enter`. Re-entering the
 * state you are already in does nothing, so calling `go` from an update loop
 * is safe.
 */
export function createStateMachine(states, initial, engine = null) {
  let current = null
  let elapsed = 0
  const events = createEvents()

  const machine = {
    states,
    on: events.on,
    get current() {
      return current
    },
    /** How long the machine has been in this state — for timed transitions. */
    get time() {
      return elapsed
    },
    is: (name) => current === name,

    go(name, payload) {
      if (name === current) return machine
      if (!states[name]) throw new Error(`No such state: ${name}`)
      states[current]?.exit?.(payload, machine)
      const previous = current
      current = name
      elapsed = 0
      states[name].enter?.(payload, machine)
      events.emit("change", name, previous)
      return machine
    },

    update(dt) {
      elapsed += dt
      states[current]?.update?.(dt, machine)
    },
  }

  if (engine) engine.onUpdate(machine.update)
  if (initial) machine.go(initial)
  return machine
}

/**
 * A score that knows its own best, and remembers it between sessions.
 *
 * The high score is the whole reason to replay a small game, and it is one
 * line of localStorage that almost every generated game forgets.
 */
export function createScore(options = {}) {
  const { key = "best", initial = 0, hud = null, label = "Score" } = options
  const store = createStorage(key)

  let value = initial
  let best = store.get("best", 0)
  const events = createEvents()

  const display = hud?.stat(label, initial)
  const bestDisplay = hud?.stat("Best", best, { at: "top-right" })

  const score = {
    on: events.on,
    get value() {
      return value
    },
    get best() {
      return best
    },
    add(amount = 1) {
      return score.set(value + amount)
    },
    set(next) {
      value = next
      display?.set(value)
      if (value > best) {
        best = value
        bestDisplay?.set(best)
        store.set("best", best)
        events.emit("best", best)
      }
      events.emit("change", value)
      return score
    },
    reset() {
      value = initial
      display?.set(value)
      events.emit("change", value)
      return score
    },
  }

  return score
}

/**
 * A namespaced corner of localStorage that never throws.
 *
 * Storage is unavailable in private windows and in some embedded contexts, and
 * an uncaught throw there takes the whole game down at load. A game that can't
 * save should still play.
 */
export function createStorage(namespace = "game") {
  const prefix = `${namespace}:`

  return {
    get(key, fallback = null) {
      try {
        const raw = localStorage.getItem(prefix + key)
        return raw === null ? fallback : JSON.parse(raw)
      } catch {
        return fallback
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(prefix + key, JSON.stringify(value))
      } catch {
        // Full, blocked, or disabled. Nothing to do, and nothing worth breaking.
      }
      return value
    },
    remove(key) {
      try {
        localStorage.removeItem(prefix + key)
      } catch {}
    },
    clear() {
      try {
        for (const key of Object.keys(localStorage)) {
          if (key.startsWith(prefix)) localStorage.removeItem(key)
        }
      } catch {}
    },
  }
}

/**
 * A countdown or a count-up. Pausable, and driven by the engine's clock rather
 * than the wall clock, so it stops when the game does.
 */
export function createTimer(options = {}) {
  const {
    duration = null,
    hud = null,
    label = "Time",
    onEnd = null,
    format,
  } = options
  const display = hud?.stat(label, duration ?? 0, {
    at: "top-center",
    format: format ?? formatTime,
    bump: false,
  })

  let time = duration ?? 0
  let running = true

  return {
    get time() {
      return time
    },
    get done() {
      return duration !== null && time <= 0
    },
    start() {
      running = true
    },
    pause() {
      running = false
    },
    reset(to = duration ?? 0) {
      time = to
      display?.set(time)
    },
    add(seconds) {
      time += seconds
      display?.set(time)
    },
    update(dt) {
      if (!running) return
      time += duration === null ? dt : -dt
      if (duration !== null && time <= 0) {
        time = 0
        running = false
        onEnd?.()
      }
      display?.set(time)
    },
  }
}

/** 83.4 seconds as "1:23". What a timer should read as, not a raw float. */
export function formatTime(seconds) {
  const total = Math.max(0, Math.floor(seconds))
  const minutes = Math.floor(total / 60)
  return `${minutes}:${String(total % 60).padStart(2, "0")}`
}

/**
 * Difficulty that climbs with time or score.
 *
 * A game whose spawn rate never changes is over as a challenge the moment the
 * player understands it. This maps elapsed progress onto a 0..1 curve you can
 * multiply anything by.
 */
export function createDifficulty(options = {}) {
  const { rampSeconds = 90, curve = (t) => t ** 0.7, max = 1 } = options
  let elapsed = 0

  return {
    /** 0 at the start, `max` once fully ramped. Read it every frame. */
    get level() {
      return Math.min(max, curve(Math.min(1, elapsed / rampSeconds)) * max)
    },
    /** Interpolates between two values along the difficulty curve. */
    between(from, to) {
      return from + (to - from) * this.level
    },
    update(dt) {
      elapsed += dt
    },
    reset() {
      elapsed = 0
    },
  }
}

/**
 * A budget for things that should happen every so often — enemy spawns, shot
 * cooldowns, ticking damage.
 *
 * Counting frames or using setInterval both drift with the framerate; this
 * accumulates real time and fires the right number of times whatever the frame
 * rate is, including more than once in a slow frame.
 */
export function createTicker(interval, callback) {
  let accumulated = 0
  return {
    interval,
    update(dt) {
      accumulated += dt
      let fired = 0
      // Capped so a huge stalled frame doesn't fire a hundred spawns at once.
      while (accumulated >= this.interval && fired < 8) {
        accumulated -= this.interval
        callback()
        fired++
      }
      if (fired >= 8) accumulated = 0
    },
    reset() {
      accumulated = 0
    },
  }
}

/** A cooldown: `if (gun.ready()) { fire(); gun.use() }`. */
export function createCooldown(seconds) {
  let remaining = 0
  return {
    get remaining() {
      return remaining
    },
    /** 0..1, for a HUD bar or a shader on the ability icon. */
    get progress() {
      return 1 - remaining / seconds
    },
    ready: () => remaining <= 0,
    use() {
      remaining = seconds
    },
    update(dt) {
      if (remaining > 0) remaining = Math.max(0, remaining - dt)
    },
  }
}
