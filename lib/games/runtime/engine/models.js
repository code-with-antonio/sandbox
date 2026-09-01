import * as THREE from "three"
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js"
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js"
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js"

import {
  matte,
  palette,
  shade,
  checkerTexture,
  textTexture,
} from "./materials.js"
import { randRange, randInt, TAU } from "./math.js"

/**
 * Things to put in the scene, built out of primitives.
 *
 * There is no art in the sandbox and no model to download, so every object in
 * every game is assembled from boxes, spheres and cylinders. That constraint is
 * fine — it is what most stylised games look like anyway — but only if the
 * assembling is already done. These are the pieces.
 *
 * Everything returns a `Group` or `Mesh` with shadows already configured, so
 * dropping one into a lit scene looks right immediately.
 */

/** Casts and receives, recursively. The step everyone forgets. */
export function castShadows(object, cast = true, receive = true) {
  object.traverse((child) => {
    if (child.isMesh) {
      child.castShadow = cast
      child.receiveShadow = receive
    }
  })
  return object
}

// --- Primitives -------------------------------------------------------------

function build(geometry, material, position) {
  const mesh = new THREE.Mesh(geometry, material)
  if (position) mesh.position.set(...position)
  mesh.castShadow = true
  mesh.receiveShadow = true
  return mesh
}

export function box(size = 1, options = {}) {
  const [w, h, d] = Array.isArray(size) ? size : [size, size, size]
  const {
    color = palette.mist,
    material = matte(color),
    position,
    radius = 0,
  } = options
  const geometry = radius
    ? new RoundedBoxGeometry(
        w,
        h,
        d,
        4,
        Math.min(radius, Math.min(w, h, d) / 2)
      )
    : new THREE.BoxGeometry(w, h, d)
  return build(geometry, material, position)
}

export function sphere(radius = 0.5, options = {}) {
  const {
    color = palette.mist,
    material = matte(color),
    position,
    segments = 24,
  } = options
  return build(
    new THREE.SphereGeometry(radius, segments, segments / 2),
    material,
    position
  )
}

export function cylinder(radius = 0.5, height = 1, options = {}) {
  const {
    color = palette.mist,
    material = matte(color),
    position,
    segments = 20,
  } = options
  return build(
    new THREE.CylinderGeometry(radius, radius, height, segments),
    material,
    position
  )
}

export function cone(radius = 0.5, height = 1, options = {}) {
  const {
    color = palette.mist,
    material = matte(color),
    position,
    segments = 20,
  } = options
  return build(
    new THREE.ConeGeometry(radius, height, segments),
    material,
    position
  )
}

export function capsule(radius = 0.4, height = 1, options = {}) {
  const { color = palette.mist, material = matte(color), position } = options
  return build(
    new THREE.CapsuleGeometry(radius, height, 6, 16),
    material,
    position
  )
}

export function torus(radius = 0.6, tube = 0.2, options = {}) {
  const { color = palette.mist, material = matte(color), position } = options
  return build(
    new THREE.TorusGeometry(radius, tube, 16, 48),
    material,
    position
  )
}

/**
 * The floor. Big, checkered by default, and lying in the XZ plane already.
 *
 * A plain-coloured ground gives the player no sense of speed or distance; the
 * repeating texture is what makes movement legible, so it is the default.
 */
export function ground(size = 100, options = {}) {
  const {
    color = "#1f1f1f",
    accent = "#171717",
    texture = checkerTexture({ light: color, dark: accent, squares: 2 }),
    repeat = size / 4,
    material,
  } = options

  if (texture) {
    texture.repeat.set(repeat, repeat)
    texture.needsUpdate = true
  }

  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size),
    material ?? matte(color, { map: texture })
  )
  mesh.rotation.x = -Math.PI / 2
  mesh.receiveShadow = true
  // A floor has nothing under it to shadow, and casting from it only costs.
  mesh.castShadow = false
  return mesh
}

/** Four walls around the play area, so nothing can wander off the level. */
export function arena(size = 40, options = {}) {
  const {
    height = 3,
    thickness = 1,
    color = palette.slate,
    material = matte(color),
  } = options
  const group = new THREE.Group()
  const half = size / 2
  const spans = [
    [
      size + thickness * 2,
      height,
      thickness,
      0,
      height / 2,
      -half - thickness / 2,
    ],
    [
      size + thickness * 2,
      height,
      thickness,
      0,
      height / 2,
      half + thickness / 2,
    ],
    [thickness, height, size, -half - thickness / 2, height / 2, 0],
    [thickness, height, size, half + thickness / 2, height / 2, 0],
  ]
  for (const [w, h, d, x, y, z] of spans) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material)
    wall.position.set(x, y, z)
    wall.castShadow = true
    wall.receiveShadow = true
    group.add(wall)
  }
  // Handed back so a physics world can be built from the same walls.
  group.userData.bounds = { size, height, thickness }
  return group
}

// --- Prefabs ----------------------------------------------------------------

/** A crate. Rounded corners and a darker frame read better than a bare cube. */
export function crate(size = 1, options = {}) {
  const { color = "#a16207", accent = shade(color, -0.15) } = options
  const group = new THREE.Group()
  group.add(box(size, { color, radius: size * 0.08 }))
  const frame = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(size, size, size)),
    new THREE.LineBasicMaterial({ color: new THREE.Color(accent) })
  )
  group.add(frame)
  return castShadows(group)
}

/** A collectible: spins on its own, hovers, and glows. Returns `update(dt)`. */
export function coin(options = {}) {
  const { radius = 0.35, color = "#facc15", thickness = 0.08 } = options
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, thickness, 24),
    matte(color, {
      emissive: new THREE.Color(color),
      emissiveIntensity: 0.5,
      metalness: 0.4,
      roughness: 0.3,
    })
  )
  // Lying flat would make it invisible from above; a coin faces the player.
  mesh.rotation.x = Math.PI / 2
  const group = new THREE.Group()
  group.add(mesh)
  castShadows(group)

  const baseY = 0
  group.userData.update = (dt, elapsed = 0) => {
    group.rotation.y += dt * 2.5
    group.position.y = baseY + Math.sin(elapsed * 2.5) * 0.12
  }
  return group
}

/** A low-poly tree. Randomised so a forest of them doesn't look stamped. */
export function tree(options = {}) {
  const {
    height = randRange(2.5, 4),
    trunk = "#78350f",
    leaves = "#15803d",
    tiers = randInt(2, 3),
  } = options
  const group = new THREE.Group()
  const trunkHeight = height * 0.4
  group.add(
    cylinder(height * 0.06, trunkHeight, {
      color: trunk,
      position: [0, trunkHeight / 2, 0],
    })
  )

  for (let i = 0; i < tiers; i++) {
    const t = i / tiers
    const tierRadius = height * 0.32 * (1 - t * 0.45)
    const tierHeight = height * 0.42 * (1 - t * 0.2)
    const y = trunkHeight + height * 0.2 * i + tierHeight / 2
    group.add(
      cone(tierRadius, tierHeight, {
        color: shade(leaves, i * 0.05),
        position: [0, y, 0],
        segments: 7,
      })
    )
  }
  group.rotation.y = Math.random() * TAU
  return castShadows(group)
}

/** A boulder — a sphere with its vertices shoved about. Never twice the same. */
export function rock(options = {}) {
  const { radius = 0.8, color = "#57534e", jitter = 0.22 } = options
  const geometry = new THREE.IcosahedronGeometry(radius, 1)
  const position = geometry.attributes.position
  for (let i = 0; i < position.count; i++) {
    const scale = 1 + randRange(-jitter, jitter)
    position.setXYZ(
      i,
      position.getX(i) * scale,
      position.getY(i) * scale * 0.8,
      position.getZ(i) * scale
    )
  }
  // Faceted rather than smooth: recomputed normals per face are the whole look.
  geometry.computeVertexNormals()
  const mesh = new THREE.Mesh(geometry, matte(color, { flatShading: true }))
  mesh.rotation.set(
    Math.random() * TAU,
    Math.random() * TAU,
    Math.random() * TAU
  )
  return castShadows(mesh)
}

export function cloud(options = {}) {
  const { color = "#f8fafc", puffs = 5, spread = 2 } = options
  const group = new THREE.Group()
  const material = matte(color, { roughness: 1 })
  for (let i = 0; i < puffs; i++) {
    const puff = new THREE.Mesh(
      new THREE.IcosahedronGeometry(randRange(0.6, 1.1), 1),
      material
    )
    puff.position.set(
      randRange(-spread, spread),
      randRange(-0.2, 0.3),
      randRange(-0.6, 0.6)
    )
    puff.castShadow = false
    puff.receiveShadow = false
    group.add(puff)
  }
  return group
}

/**
 * A blocky humanoid, with every part named so the game can animate it.
 *
 * `character.parts` holds head, body, armLeft, armRight, legLeft, legRight —
 * enough for a walk cycle, a wave, a hit reaction and a death flop. The group's
 * origin is at the feet, which is what movement and ground checks assume.
 */
export function character(options = {}) {
  const {
    skin = palette.amber,
    shirt = palette.ember,
    trousers = palette.slate,
    height = 1.8,
  } = options

  const unit = height / 8
  const group = new THREE.Group()
  const parts = {}

  const bodyHeight = unit * 3
  parts.body = box([unit * 2.2, bodyHeight, unit * 1.2], {
    color: shirt,
    radius: unit * 0.2,
    position: [0, unit * 3 + bodyHeight / 2, 0],
  })

  parts.head = box([unit * 1.7, unit * 1.7, unit * 1.7], {
    color: skin,
    radius: unit * 0.35,
    position: [0, unit * 6 + unit * 1.1, 0],
  })

  const limb = (x, color, length, y) => {
    // Pivot at the shoulder/hip, not the middle: a limb group rotated about its
    // centre bends in the wrong place and nothing looks like walking.
    const pivot = new THREE.Group()
    pivot.position.set(x, y, 0)
    const mesh = box([unit * 0.75, length, unit * 0.75], {
      color,
      radius: unit * 0.2,
      position: [0, -length / 2, 0],
    })
    pivot.add(mesh)
    return pivot
  }

  const armY = unit * 6
  const armLength = unit * 2.8
  parts.armLeft = limb(-unit * 1.5, shirt, armLength, armY)
  parts.armRight = limb(unit * 1.5, shirt, armLength, armY)

  const legY = unit * 3
  const legLength = unit * 3
  parts.legLeft = limb(-unit * 0.6, trousers, legLength, legY)
  parts.legRight = limb(unit * 0.6, trousers, legLength, legY)

  group.add(...Object.values(parts))
  group.userData.parts = parts
  group.userData.height = height

  /**
   * A walk cycle from a sine wave. `speed` 0 settles into an idle sway.
   * Call every frame with the elapsed time and how fast the character is going.
   */
  group.userData.animate = (elapsed, speed = 1) => {
    const swing = Math.sin(elapsed * 9) * Math.min(speed, 1)
    parts.legLeft.rotation.x = swing * 0.8
    parts.legRight.rotation.x = -swing * 0.8
    parts.armLeft.rotation.x = -swing * 0.6
    parts.armRight.rotation.x = swing * 0.6
    parts.body.position.y =
      unit * 3 + bodyHeight / 2 + Math.abs(swing) * unit * 0.12
    parts.head.rotation.z =
      Math.sin(elapsed * 2) * 0.04 * (1 - Math.min(speed, 1))
  }

  return castShadows(group)
}

/** A simple car/ship body. Points down -Z, which is three.js's "forward". */
export function vehicle(options = {}) {
  const {
    color = palette.ember,
    accent = palette.slate,
    length = 3,
    width = 1.6,
  } = options
  const group = new THREE.Group()

  group.add(
    box([width, 0.5, length], { color, radius: 0.18, position: [0, 0.5, 0] })
  )
  group.add(
    box([width * 0.75, 0.45, length * 0.42], {
      color: accent,
      radius: 0.12,
      position: [0, 0.95, -0.1],
    })
  )

  const wheelGeometry = new THREE.CylinderGeometry(0.34, 0.34, 0.25, 16)
  const wheelMaterial = matte("#111111")
  for (const [x, z] of [
    [-width / 2, -length / 3],
    [width / 2, -length / 3],
    [-width / 2, length / 3],
    [width / 2, length / 3],
  ]) {
    const wheel = new THREE.Mesh(wheelGeometry, wheelMaterial)
    wheel.rotation.z = Math.PI / 2
    wheel.position.set(x, 0.34, z)
    group.add(wheel)
  }

  return castShadows(group)
}

/** An expanding ring for impacts, shockwaves and pickup pops. */
export function ring(options = {}) {
  const { radius = 0.5, color = palette.ember, thickness = 0.08 } = options
  const mesh = new THREE.Mesh(
    new THREE.RingGeometry(radius - thickness, radius, 48),
    new THREE.MeshBasicMaterial({
      color: new THREE.Color(color),
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
  )
  mesh.rotation.x = -Math.PI / 2
  return mesh
}

/**
 * Floating text that always faces the camera — damage numbers, names, signs.
 *
 * A Sprite rather than a mesh, so it never turns away from the player and never
 * needs to be re-aimed as the camera moves.
 */
export function label(text, options = {}) {
  const {
    color = "#ffffff",
    size = 0.5,
    background = "transparent",
    font,
  } = options
  const draw = (value) =>
    textTexture(value, { color, background, ...(font ? { font } : {}) })

  const texture = draw(text)
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
    })
  )
  const fit = (map) =>
    sprite.scale.set((size * map.image.width) / map.image.height, size, 1)
  fit(texture)

  /** Swaps the text in place — for a live score, a timer, a nameplate. */
  sprite.setText = (next) => {
    sprite.material.map.dispose()
    const updated = draw(next)
    sprite.material.map = updated
    fit(updated)
  }
  return sprite
}

// --- Many of the same thing -------------------------------------------------

/**
 * One draw call for thousands of copies of one mesh.
 *
 * A field of a thousand separate trees is a thousand draw calls and a slideshow;
 * as an InstancedMesh it is one. Use this for grass, stars, bullets, debris —
 * anything numerous that shares a shape.
 *
 *   const stars = instances(geometry, material, 2000)
 *   stars.place(i, [x, y, z], { scale: 0.3 })
 */
export function instances(geometry, material, count) {
  const mesh = new THREE.InstancedMesh(geometry, material, count)
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  mesh.castShadow = true
  mesh.receiveShadow = true

  const matrix = new THREE.Matrix4()
  const position = new THREE.Vector3()
  const quaternion = new THREE.Quaternion()
  const scale = new THREE.Vector3(1, 1, 1)
  const euler = new THREE.Euler()

  mesh.place = (index, pos, options = {}) => {
    position.set(...(Array.isArray(pos) ? pos : [pos.x, pos.y, pos.z]))
    if (options.rotation) {
      euler.set(...options.rotation)
      quaternion.setFromEuler(euler)
    } else {
      quaternion.identity()
    }
    const s = options.scale ?? 1
    scale.set(...(Array.isArray(s) ? s : [s, s, s]))
    matrix.compose(position, quaternion, scale)
    mesh.setMatrixAt(index, matrix)
    // Deferred: setting it per instance would upload the whole buffer each time.
    mesh.instanceMatrix.needsUpdate = true
    return mesh
  }

  /** Sends an instance off-screen — the cheapest way to "remove" one. */
  mesh.hide = (index) => mesh.place(index, [0, -9999, 0], { scale: 0.0001 })

  mesh.tint = (index, color) => {
    if (!mesh.instanceColor) {
      mesh.instanceColor = new THREE.InstancedBufferAttribute(
        new Float32Array(count * 3).fill(1),
        3
      )
    }
    mesh.setColorAt(index, new THREE.Color(color))
    mesh.instanceColor.needsUpdate = true
    return mesh
  }

  return mesh
}

/** Welds static meshes into one geometry. Scenery that never moves, made free. */
export function merge(meshes) {
  const geometries = meshes.map((mesh) => {
    const geometry = mesh.geometry.clone()
    mesh.updateWorldMatrix(true, false)
    geometry.applyMatrix4(mesh.matrixWorld)
    return geometry
  })
  const merged = mergeGeometries(geometries, false)
  const mesh = new THREE.Mesh(merged, meshes[0].material)
  mesh.castShadow = true
  mesh.receiveShadow = true
  for (const geometry of geometries) geometry.dispose()
  return mesh
}

/**
 * Recycles objects instead of making and destroying them.
 *
 * Spawning a bullet per shot allocates, and the garbage collector eventually
 * pauses the frame to clean up — which the player feels as a stutter exactly
 * when the screen is busiest. A pool never allocates after warm-up.
 *
 *   const bullets = createPool(() => sphere(0.1), { size: 64 })
 *   const b = bullets.take(); ... bullets.give(b)
 */
export function createPool(factory, options = {}) {
  const { size = 32, parent = null, onTake = null, onGive = null } = options
  const free = []
  const live = new Set()

  for (let i = 0; i < size; i++) {
    const item = factory()
    item.visible = false
    parent?.add(item)
    free.push(item)
  }

  return {
    live,
    get count() {
      return live.size
    },
    /** An idle object, or a new one if the pool has run dry. */
    take() {
      const item = free.pop() ?? factory()
      if (parent && !item.parent) parent.add(item)
      item.visible = true
      live.add(item)
      onTake?.(item)
      return item
    },
    give(item) {
      if (!live.delete(item)) return
      item.visible = false
      onGive?.(item)
      free.push(item)
    },
    /** Runs `fn(item)` over everything in flight; return true to retire it. */
    each(fn) {
      for (const item of [...live]) {
        if (fn(item) === true) this.give(item)
      }
    },
    clear() {
      for (const item of [...live]) this.give(item)
    },
  }
}

// --- Loading ----------------------------------------------------------------

const gltfLoader = new GLTFLoader()
const textureLoader = new THREE.TextureLoader()

/**
 * Loads a .glb/.gltf from a url. There is no local model in the sandbox, so
 * this is only for a CDN url you are certain resolves — a wrong one leaves the
 * game with nothing on screen.
 */
export function loadModel(url) {
  return new Promise((resolve, reject) => {
    gltfLoader.load(
      url,
      (gltf) => {
        castShadows(gltf.scene)
        resolve({ scene: gltf.scene, animations: gltf.animations, gltf })
      },
      undefined,
      reject
    )
  })
}

export function loadTexture(url, options = {}) {
  return new Promise((resolve, reject) => {
    textureLoader.load(
      url,
      (texture) => {
        texture.colorSpace = options.data
          ? THREE.NoColorSpace
          : THREE.SRGBColorSpace
        if (options.repeat) {
          texture.wrapS = texture.wrapT = THREE.RepeatWrapping
          texture.repeat.set(...options.repeat)
        }
        resolve(texture)
      },
      undefined,
      reject
    )
  })
}
