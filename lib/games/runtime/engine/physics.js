import * as THREE from "three"

import { clamp } from "./math.js"

/**
 * Arcade collision — the kind games actually want.
 *
 * Not a rigid-body simulation. Nothing here tumbles, stacks or conserves
 * momentum, because almost no game needs that and every game that pulls in a
 * physics engine for it pays with a dependency, a tuning problem and a
 * character that slides down slopes. What games do need is: don't fall through
 * the floor, don't walk through walls, slide along them instead of stopping
 * dead, and tell me when two things touched. That is what this is.
 *
 *   const world = createPhysics()
 *   world.addBox(wall)                 // static, from any mesh
 *   const body = world.addBody({ radius: 0.5, height: 1.8 })
 *   body.velocity.x = 4
 *   world.step(dt)                     // in your engine.onUpdate
 */

const UP = new THREE.Vector3(0, 1, 0)

export function createPhysics(options = {}) {
  const {
    gravity = -24,
    // Real gravity (-9.81) makes a jump feel floaty and slow on a game's
    // timescale. Platformers all use something around this instead.
    groundFriction = 12,
    airFriction = 0.6,
    maxSlope = 0.7,
  } = options

  const statics = []
  const bodies = []
  const triggers = []

  const world = { gravity, statics, bodies, triggers }

  // --- Static geometry ------------------------------------------------------

  /** A solid box. Pass a mesh and its world bounding box is used. */
  function addBox(source, extra = {}) {
    const box = source.isObject3D
      ? new THREE.Box3().setFromObject(source)
      : new THREE.Box3(
          new THREE.Vector3(...source.min),
          new THREE.Vector3(...source.max)
        )
    const collider = {
      type: "box",
      box,
      object: source.isObject3D ? source : null,
      ...extra,
    }
    statics.push(collider)
    return collider
  }

  /** An infinite floor at height `y`. Cheaper and steadier than a box. */
  function addGround(y = 0, extra = {}) {
    const collider = { type: "ground", y, ...extra }
    statics.push(collider)
    return collider
  }

  function addSphere(center, radius, extra = {}) {
    const collider = {
      type: "sphere",
      center: center.isVector3 ? center : new THREE.Vector3(...center),
      radius,
      ...extra,
    }
    statics.push(collider)
    return collider
  }

  /** Everything a `models.arena()` walls off, in one call. */
  function addArena(group) {
    const bounds = group.userData.bounds
    if (!bounds) return group.children.map((wall) => addBox(wall))
    return group.children.map((wall) => addBox(wall))
  }

  function removeCollider(collider) {
    const index = statics.indexOf(collider)
    if (index >= 0) statics.splice(index, 1)
  }

  // --- Bodies ---------------------------------------------------------------

  /**
   * A moving thing. Bodies are vertical capsules — a radius and a height —
   * because that is the shape that walks up a step and round a corner without
   * catching, which a box does not.
   */
  function addBody(config = {}) {
    const {
      object = null,
      radius = 0.5,
      height = 1,
      position = object?.position?.toArray() ?? [0, 0, 0],
      gravityScale = 1,
      bounce = 0,
      friction = groundFriction,
      // Something that detects but never blocks — a pickup, a checkpoint.
      trigger = false,
      tag = null,
      data = {},
    } = config

    const body = {
      object,
      position: new THREE.Vector3(...position),
      velocity: new THREE.Vector3(),
      radius,
      height,
      gravityScale,
      bounce,
      friction,
      trigger,
      tag,
      data,
      grounded: false,
      groundY: 0,
      enabled: true,
      /** Set by `step` each frame: the surfaces hit, for wall-jumps and dust. */
      contacts: [],
    }

    if (trigger) triggers.push(body)
    else bodies.push(body)
    return body
  }

  function removeBody(body) {
    for (const list of [bodies, triggers]) {
      const index = list.indexOf(body)
      if (index >= 0) list.splice(index, 1)
    }
  }

  // --- Resolution -----------------------------------------------------------

  const closest = new THREE.Vector3()
  const push = new THREE.Vector3()

  /** Nudges a body out of one collider, and reports which way it was pushed. */
  function resolve(body, collider) {
    if (collider.type === "ground") {
      const floor = collider.y + body.radius
      if (body.position.y < floor) {
        body.position.y = floor
        return UP
      }
      return null
    }

    if (collider.type === "sphere") {
      push.copy(body.position).sub(collider.center)
      const distance = push.length()
      const minimum = collider.radius + body.radius
      if (distance >= minimum || distance === 0) return null
      push.multiplyScalar(1 / distance)
      body.position.copy(collider.center).addScaledVector(push, minimum)
      return push.clone()
    }

    // Box: the nearest point on the box to the body's centre. If it is closer
    // than the radius, push straight out along that line — the standard
    // sphere-vs-AABB resolution, and the reason bodies slide along walls
    // instead of sticking to them.
    const { box } = collider
    closest.set(
      clamp(body.position.x, box.min.x, box.max.x),
      clamp(body.position.y, box.min.y, box.max.y),
      clamp(body.position.z, box.min.z, box.max.z)
    )
    push.copy(body.position).sub(closest)
    const distanceSq = push.lengthSq()
    if (distanceSq >= body.radius * body.radius) return null

    if (distanceSq > 1e-8) {
      const distance = Math.sqrt(distanceSq)
      push.multiplyScalar(1 / distance)
      body.position.copy(closest).addScaledVector(push, body.radius)
      return push.clone()
    }

    // Dead centre inside the box — no direction to push along, so leave by the
    // nearest face. Rare, but it is how a body teleported into a wall escapes.
    const center = box.getCenter(new THREE.Vector3())
    const size = box.getSize(new THREE.Vector3()).multiplyScalar(0.5)
    const delta = body.position.clone().sub(center)
    const overlap = size.clone().addScalar(body.radius).sub(delta.clone().abs())
    if (overlap.x < overlap.y && overlap.x < overlap.z) {
      push.set(Math.sign(delta.x) || 1, 0, 0)
    } else if (overlap.y < overlap.z) {
      push.set(0, Math.sign(delta.y) || 1, 0)
    } else {
      push.set(0, 0, Math.sign(delta.z) || 1)
    }
    body.position.addScaledVector(push, overlap.dot(push.clone().abs()))
    return push.clone()
  }

  function overlaps(a, b) {
    const dx = a.position.x - b.position.x
    const dz = a.position.z - b.position.z
    const dy = a.position.y - b.position.y
    const reach = a.radius + b.radius
    const tall = (a.height + b.height) / 2 + reach
    return dx * dx + dz * dz < reach * reach && Math.abs(dy) < tall
  }

  // --- Step -----------------------------------------------------------------

  function step(dt) {
    for (const body of bodies) {
      if (!body.enabled) continue

      body.velocity.y += gravity * body.gravityScale * dt
      body.position.addScaledVector(body.velocity, dt)

      body.contacts.length = 0
      const wasGrounded = body.grounded
      body.grounded = false

      for (const collider of statics) {
        if (collider.disabled) continue
        const normal = resolve(body, collider)
        if (!normal) continue

        body.contacts.push({ collider, normal })

        if (normal.y > maxSlope) {
          // Landed. Kill downward speed, or bounce it back if the body is bouncy.
          body.grounded = true
          body.groundY = body.position.y - body.radius
          if (body.velocity.y < 0) {
            body.velocity.y = body.bounce ? -body.velocity.y * body.bounce : 0
            // Below a threshold a bounce is just jitter; stop it dead.
            if (Math.abs(body.velocity.y) < 1) body.velocity.y = 0
          }
        } else {
          // A wall or a ceiling. Remove only the component going into it, which
          // is what leaves the sideways motion intact and makes sliding work.
          const into = body.velocity.dot(normal)
          if (into < 0)
            body.velocity.addScaledVector(normal, -into * (1 + body.bounce))
        }
      }

      // Horizontal drag, applied as a decay per second so it is framerate-safe.
      const drag = body.grounded ? body.friction : airFriction
      const decay = Math.exp(-drag * dt)
      body.velocity.x *= decay
      body.velocity.z *= decay

      if (body.grounded && !wasGrounded) body.onLand?.(body)
      body.object?.position.copy(body.position)
    }

    // Triggers never block, they only report — checked after everything moved,
    // so a pickup is collected at the position the player ended the frame at.
    for (const trigger of triggers) {
      if (!trigger.enabled) continue
      for (const body of bodies) {
        if (!body.enabled) continue
        const touching = overlaps(trigger, body)
        const key = `_hit_${bodies.indexOf(body)}`
        if (touching && !trigger[key]) trigger.onEnter?.(body, trigger)
        else if (!touching && trigger[key]) trigger.onExit?.(body, trigger)
        trigger[key] = touching
      }
      trigger.object?.position.copy(trigger.position)
    }
  }

  // --- Queries --------------------------------------------------------------

  const raycaster = new THREE.Raycaster()
  const down = new THREE.Vector3(0, -1, 0)

  /**
   * The height of the ground under a point, by raycasting real meshes.
   *
   * Use this for terrain, ramps and anything the box colliders above can't
   * describe. `meshes` are the visual meshes themselves.
   */
  function groundAt(x, z, meshes, from = 100) {
    raycaster.set(new THREE.Vector3(x, from, z), down)
    const hit = raycaster.intersectObjects(meshes, true)[0]
    return hit ? hit.point.y : null
  }

  /** First thing a ray hits, as `{ point, normal, object, distance }` or null. */
  function raycast(origin, direction, meshes, far = 1000) {
    raycaster.set(origin, direction.clone().normalize())
    raycaster.far = far
    const hit = raycaster.intersectObjects(meshes, true)[0]
    raycaster.far = Infinity
    return hit
      ? {
          point: hit.point,
          normal: hit.normal,
          object: hit.object,
          distance: hit.distance,
        }
      : null
  }

  return Object.assign(world, {
    addBox,
    addGround,
    addSphere,
    addArena,
    removeCollider,
    addBody,
    removeBody,
    step,
    overlaps,
    groundAt,
    raycast,
  })
}

/**
 * Whether two spheres touch — for bullets, pickups and hitboxes that don't
 * need a body in the world. `a` and `b` are anything with `.position`.
 */
export function hits(a, b, radiusA = 0.5, radiusB = 0.5) {
  const reach = radiusA + radiusB
  return a.position.distanceToSquared(b.position) < reach * reach
}

/** Whether a point is inside an axis-aligned box, given as centre and size. */
export function inside(point, center, size) {
  return (
    Math.abs(point.x - center.x) <= size.x / 2 &&
    Math.abs(point.y - center.y) <= size.y / 2 &&
    Math.abs(point.z - center.z) <= size.z / 2
  )
}
