import * as THREE from "three"
import { OrbitControls } from "three/addons/controls/OrbitControls.js"

import { clamp, damp, dampAngle, dampVec } from "./math.js"

/**
 * Cameras that follow, and characters that move.
 *
 * The camera is half of how a 3D game feels, and a camera glued rigidly to the
 * player is the fastest way to make one unplayable — it transmits every bump
 * straight into the viewport. Every rig here smooths, and smooths in a way that
 * doesn't change with the framerate.
 *
 * Controllers write to a `physics` body when given one, and straight to the
 * object's position when not, so they work before a game has any collision.
 */

// --- Cameras ----------------------------------------------------------------

/** Mouse-orbit for menus, level editors, model viewers. Wraps three's own. */
export function orbitCamera(engine, options = {}) {
  const {
    target = [0, 0, 0],
    minDistance = 2,
    maxDistance = 80,
    autoRotate = false,
  } = options
  const controls = new OrbitControls(engine.camera, engine.canvas)
  controls.enableDamping = true
  controls.dampingFactor = 0.06
  controls.target.set(...target)
  controls.minDistance = minDistance
  controls.maxDistance = maxDistance
  // Stops the camera going under the floor, which is disorienting every time.
  controls.maxPolarAngle = Math.PI * 0.495
  controls.autoRotate = autoRotate
  controls.autoRotateSpeed = 0.6
  engine.onUpdate(() => controls.update())
  return controls
}

/**
 * Third-person chase camera.
 *
 * Sits behind and above the target and lags into place. `stiffness` is how
 * quickly it catches up — low is cinematic, high is responsive; a fast game
 * wants 8 or more or the player outruns their own view.
 */
export function followCamera(engine, target, options = {}) {
  const {
    distance = 8,
    height = 4,
    stiffness = 6,
    lookHeight = 1,
    lookAhead = 0,
    // Turns with the target instead of staying behind it in world space.
    behind = true,
  } = options

  const camera = engine.camera
  const desired = new THREE.Vector3()
  const lookAt = new THREE.Vector3()
  const smoothLook = new THREE.Vector3()
  const offset = new THREE.Vector3()
  const forward = new THREE.Vector3()
  const shake = { amount: 0, decay: 4 }

  const rig = {
    target,
    distance,
    height,
    stiffness,
    /** A hit, an explosion, a landing. Decays on its own. */
    shake(amount = 0.4, decay = 4) {
      shake.amount = Math.max(shake.amount, amount)
      shake.decay = decay
    },
    setTarget(next) {
      rig.target = next
    },
  }

  const update = (dt) => {
    if (!rig.target) return
    const position = rig.target.position

    if (behind) {
      // -Z is forward in three.js, so this is the target's own back.
      forward.set(0, 0, 1).applyQuaternion(rig.target.quaternion)
      offset.copy(forward).multiplyScalar(rig.distance)
    } else {
      offset.set(0, 0, rig.distance)
    }
    desired.copy(position).add(offset)
    desired.y = position.y + rig.height

    dampVec(camera.position, desired, rig.stiffness, dt)

    lookAt.copy(position)
    lookAt.y += lookHeight
    if (lookAhead && rig.target.userData?.velocity) {
      lookAt.addScaledVector(rig.target.userData.velocity, lookAhead)
    }
    // The look point is smoothed too — snapping it is what causes the jitter
    // people try to fix by smoothing the position harder.
    dampVec(smoothLook, lookAt, rig.stiffness * 1.5, dt)
    camera.lookAt(smoothLook)

    if (shake.amount > 0.001) {
      camera.position.x += (Math.random() - 0.5) * shake.amount
      camera.position.y += (Math.random() - 0.5) * shake.amount
      camera.position.z += (Math.random() - 0.5) * shake.amount
      shake.amount *= Math.exp(-shake.decay * dt)
    } else {
      shake.amount = 0
    }
  }

  // Late, so the camera sees where things ended up rather than where they were.
  rig.stop = engine.onLateUpdate(update)
  smoothLook.copy(target?.position ?? new THREE.Vector3())
  return rig
}

/** Straight down, or on a fixed diagonal. For twin-stick, strategy, puzzle. */
export function topDownCamera(engine, target, options = {}) {
  const { height = 18, tilt = 0.35, stiffness = 6, bounds = null } = options
  const camera = engine.camera
  const desired = new THREE.Vector3()
  const rig = { target, height, stiffness }

  rig.stop = engine.onLateUpdate((dt) => {
    if (!rig.target) return
    desired.set(
      rig.target.position.x,
      rig.target.position.y + rig.height,
      rig.target.position.z + rig.height * tilt
    )
    if (bounds) {
      desired.x = clamp(desired.x, bounds.minX, bounds.maxX)
      desired.z = clamp(desired.z, bounds.minZ, bounds.maxZ)
    }
    dampVec(camera.position, desired, rig.stiffness, dt)
    camera.lookAt(
      rig.target.position.x,
      rig.target.position.y,
      rig.target.position.z
    )
  })

  return rig
}

/** A 2D-style side view: the camera tracks X and Y, never Z. Platformers. */
export function sideCamera(engine, target, options = {}) {
  const {
    distance = 14,
    stiffness = 5,
    offsetY = 1.5,
    deadzone = 1.2,
  } = options
  const camera = engine.camera
  const focus = new THREE.Vector3()
  const rig = { target, distance, stiffness }

  camera.position.z = distance

  rig.stop = engine.onLateUpdate((dt) => {
    if (!rig.target) return
    // A deadzone means small hops don't move the camera at all, which is what
    // stops a platformer's view from bobbing with every jump.
    const dx = rig.target.position.x - focus.x
    const dy = rig.target.position.y + offsetY - focus.y
    if (Math.abs(dx) > deadzone) focus.x += dx - Math.sign(dx) * deadzone
    if (Math.abs(dy) > deadzone) focus.y += dy - Math.sign(dy) * deadzone

    camera.position.x = damp(camera.position.x, focus.x, rig.stiffness, dt)
    camera.position.y = damp(camera.position.y, focus.y, rig.stiffness, dt)
    camera.position.z = rig.distance
    camera.lookAt(camera.position.x, camera.position.y, 0)
  })

  return rig
}

// --- Controllers ------------------------------------------------------------

/**
 * First person: mouse looks, WASD walks, space jumps.
 *
 * Yaw goes on a holder and pitch on the camera, rather than both on the camera,
 * because Euler rotation on all three axes at once rolls the horizon — the
 * "why is my view tilting" bug that has no obvious cause.
 */
export function firstPerson(engine, input, options = {}) {
  const {
    body = null,
    speed = 7,
    sprintSpeed = 11,
    jump = 9,
    sensitivity = 0.0022,
    eyeHeight = 1.7,
    position = [0, eyeHeight, 6],
    // Clicking to capture the mouse is the convention, and browsers require a
    // gesture for it anyway.
    lockOnClick = true,
  } = options

  const yaw = new THREE.Object3D()
  yaw.position.set(...position)
  engine.scene.add(yaw)
  yaw.add(engine.camera)
  engine.camera.position.set(0, 0, 0)
  engine.camera.rotation.set(0, 0, 0)

  if (lockOnClick) {
    engine.canvas.addEventListener("pointerdown", () =>
      input.requestPointerLock()
    )
  }

  const forward = new THREE.Vector3()
  const right = new THREE.Vector3()
  const move = new THREE.Vector3()
  let pitch = 0
  let bobPhase = 0

  const controller = {
    object: yaw,
    body,
    speed,
    get grounded() {
      return body ? body.grounded : yaw.position.y <= eyeHeight + 0.001
    },
  }

  controller.stop = engine.onUpdate((dt) => {
    if (input.locked || !lockOnClick) {
      yaw.rotation.y -= input.look.x * sensitivity
      pitch = clamp(
        pitch - input.look.y * sensitivity,
        -Math.PI / 2 + 0.05,
        Math.PI / 2 - 0.05
      )
      engine.camera.rotation.x = pitch
    }

    forward
      .set(0, 0, -1)
      .applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw.rotation.y)
    right
      .set(1, 0, 0)
      .applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw.rotation.y)

    const rate = input.down("sprint") ? sprintSpeed : controller.speed
    move.set(0, 0, 0)
    move.addScaledVector(forward, -input.move.y)
    move.addScaledVector(right, input.move.x)
    if (move.lengthSq() > 0) move.normalize().multiplyScalar(rate)

    if (body) {
      // Set the horizontal velocity outright rather than adding force: walking
      // should stop the instant the key is released, not coast.
      body.velocity.x = move.x
      body.velocity.z = move.z
      if (input.pressed("jump") && body.grounded) body.velocity.y = jump
      yaw.position.copy(body.position)
      yaw.position.y += eyeHeight - body.radius
    } else {
      yaw.position.addScaledVector(move, dt)
    }

    // Head bob, scaled by actual speed so it stops when the player does.
    const travelling = move.length() / Math.max(rate, 0.001)
    bobPhase += dt * 11 * travelling
    engine.camera.position.y = Math.sin(bobPhase) * 0.045 * travelling
  })

  return controller
}

/**
 * Third person: the character moves in camera space and turns to face where it
 * is going. The standard scheme for anything with a visible protagonist.
 */
export function thirdPerson(engine, input, object, options = {}) {
  const {
    body = null,
    speed = 6,
    sprintSpeed = 10,
    jump = 10,
    turnRate = 12,
    // Without this the character walks in world directions and fights whatever
    // way the camera happens to be pointing.
    relativeTo = engine.camera,
  } = options

  const move = new THREE.Vector3()
  const forward = new THREE.Vector3()
  const right = new THREE.Vector3()
  const velocity = new THREE.Vector3()
  object.userData.velocity = velocity

  const controller = {
    object,
    body,
    speed,
    velocity,
    /** 0..1, for driving a walk cycle or a footstep sound. */
    travel: 0,
    get grounded() {
      return body ? body.grounded : object.position.y <= 0.001
    },
  }

  controller.stop = engine.onUpdate((dt) => {
    relativeTo.getWorldDirection(forward)
    forward.y = 0
    forward.normalize()
    right.crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize()

    const rate = input.down("sprint") ? sprintSpeed : controller.speed
    move.set(0, 0, 0)
    move.addScaledVector(forward, -input.move.y)
    move.addScaledVector(right, input.move.x)
    if (move.lengthSq() > 0) move.normalize().multiplyScalar(rate)

    controller.travel = move.length() / Math.max(rate, 0.001)

    if (body) {
      body.velocity.x = move.x
      body.velocity.z = move.z
      if (input.pressed("jump") && body.grounded) body.velocity.y = jump
      object.position.copy(body.position)
      object.position.y -= body.radius
      velocity.copy(body.velocity)
    } else {
      object.position.addScaledVector(move, dt)
      velocity.copy(move)
    }

    // Turn toward travel, never snap. `dampAngle` takes the short way round, so
    // a character reversing turns through 180° rather than the long way.
    if (move.lengthSq() > 0.001) {
      const heading = Math.atan2(move.x, move.z)
      object.rotation.y = dampAngle(object.rotation.y, heading, turnRate, dt)
    }
  })

  return controller
}

/**
 * Side-on platformer movement: left/right, jump, gravity, coyote time.
 *
 * Coyote time and the jump buffer are the two things that separate a platformer
 * that feels tight from one that feels broken. They let a jump register just
 * after leaving a ledge and just before landing — players read both as their
 * own timing being right, and their absence as the game dropping inputs.
 */
export function platformer(engine, input, object, options = {}) {
  const {
    body = null,
    speed = 8,
    acceleration = 60,
    jump = 14,
    gravity = -40,
    coyoteTime = 0.12,
    jumpBuffer = 0.12,
    // Cutting the rise when the button is released gives variable jump height.
    shortHopFactor = 0.45,
    plane = "x",
  } = options

  const velocity = body ? body.velocity : new THREE.Vector3()
  object.userData.velocity = velocity
  let sinceGrounded = Infinity
  let sinceJumpPress = Infinity

  const controller = {
    object,
    body,
    velocity,
    speed,
    get grounded() {
      return body ? body.grounded : object.position.y <= 0.001
    },
  }

  controller.stop = engine.onUpdate((dt) => {
    const grounded = controller.grounded
    sinceGrounded = grounded ? 0 : sinceGrounded + dt
    sinceJumpPress = input.pressed("jump") ? 0 : sinceJumpPress + dt

    const wanted = input.move.x * speed
    const axis = plane
    velocity[axis] +=
      (wanted - velocity[axis]) * Math.min(1, acceleration * dt * 0.1)

    if (sinceJumpPress <= jumpBuffer && sinceGrounded <= coyoteTime) {
      velocity.y = jump
      sinceJumpPress = Infinity
      sinceGrounded = Infinity
    }
    if (input.released("jump") && velocity.y > 0) velocity.y *= shortHopFactor

    if (!body) {
      velocity.y += gravity * dt
      object.position.addScaledVector(velocity, dt)
      if (object.position.y < 0) {
        object.position.y = 0
        velocity.y = 0
      }
    } else {
      object.position.copy(body.position)
    }

    // Face the way of travel — a flipped sprite, or a turned model.
    if (Math.abs(velocity[axis]) > 0.1) {
      object.rotation.y = velocity[axis] > 0 ? Math.PI / 2 : -Math.PI / 2
    }
  })

  return controller
}

/**
 * Turns a mouse position into a point on the ground.
 *
 * The one calculation every top-down game needs — aiming, click-to-move, tower
 * placement — and it is a ray/plane intersection rather than a raycast against
 * meshes, so it works over empty space too.
 */
export function pointerOnGround(engine, input, height = 0) {
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -height)
  const raycaster = new THREE.Raycaster()
  const point = new THREE.Vector3()

  return () => {
    raycaster.setFromCamera(input.pointer, engine.camera)
    return raycaster.ray.intersectPlane(plane, point) ? point : null
  }
}

/** What's under the cursor, of the objects you care about. Click-to-select. */
export function pointerPicker(engine, input, objects) {
  const raycaster = new THREE.Raycaster()
  return () => {
    raycaster.setFromCamera(input.pointer, engine.camera)
    return raycaster.intersectObjects(objects, true)[0] ?? null
  }
}
