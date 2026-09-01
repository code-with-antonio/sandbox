import * as THREE from "three"

import {
  createEngine,
  createPostFX,
  materials,
  models,
  lights,
  math,
} from "./engine/index.js"

/**
 * The holding screen: the product's mark, as a rotating solid.
 *
 * Also the shortest worked example of `./engine/` there is — an engine, a light
 * rig, a couple of models, a bloom pass and an update loop, which is the shape
 * of every game built on top of it.
 */

const EMBER = "#ea580c"
const AMBER = "#fb923c"

const engine = createEngine({
  background: "#0a0a0a",
  fov: 40,
  cameraPosition: [0, 2.1, 9],
  lookAt: [0, 1.15, 0],
  // A gentle depth haze, so the floor fades out rather than ending at an edge.
  fog: { color: "#0a0a0a", near: 9, far: 24 },
  // Slightly under 1: ACES tone mapping rolls highlights off gracefully, but a
  // saturated orange still clips to white if it is pushed all the way up, and
  // clipped orange is just white.
  exposure: 0.92,
})

// --- The mark ---------------------------------------------------------------

// The logo reads as a cube because its faces are one orange at different
// brightnesses. Six materials in BoxGeometry's own face order — +X, -X, +Y, -Y,
// +Z, -Z — reproduce that from every angle rather than from one.
const FACES = ["#ea580c", "#c2410c", "#fb923c", "#7c2d12", "#f97316", "#9a3412"]

const faces = FACES.map((color) =>
  materials.standard({
    color,
    // Rough and non-metallic on purpose. A tighter surface puts a specular
    // hotspot on the top face that clips to white under any key light, and a
    // white blot in the middle of the mark is the one thing it must not have.
    roughness: 0.72,
    metalness: 0,
    // Emissive in the face's own colour, not white: enough to keep the dark
    // faces off black and to give bloom something on the light ones, without
    // desaturating the orange that is the whole point of the mark.
    emissive: new THREE.Color(color),
    emissiveIntensity: 0.12,
  })
)

const cube = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.8, 1.8), faces)
cube.castShadow = true

// Bright edges, drawn as lines rather than modelled — the logo's facets meet at
// a visible seam, and this is that seam for one draw call.
const edges = new THREE.LineSegments(
  new THREE.EdgesGeometry(cube.geometry),
  new THREE.LineBasicMaterial({ color: new THREE.Color(EMBER) })
)
cube.add(edges)

// Tilted the way the logo is: turned a little and tipped forward, so three
// faces are in view at rest instead of one flat square.
const mark = new THREE.Group()
mark.position.y = 1.25
mark.rotation.set(math.DEG * 18, math.DEG * 32, 0)
mark.add(cube)
engine.add(mark)

// --- The room ---------------------------------------------------------------

const floor = models.ground(60, { color: "#1a1a1a", accent: "#141414" })
engine.add(floor)

const shadow = lights.blobShadow(engine.scene, mark, {
  radius: 1.5,
  opacity: 0.5,
})

// Dim, so the mark's own colour survives. A bright white key would bleach the
// orange to pink, which is the failure this whole scene is tuned against.
lights.studio(engine.scene, { intensity: 0.42 })

// A backlight, not a fill. Set well back rather than just behind: close in, its
// falloff puts a blown-out hotspot on whichever edge is nearest, and the bloom
// pass turns that into a flare over the silhouette.
const glow = new THREE.PointLight(new THREE.Color(EMBER), 34, 14, 2)
glow.position.set(0, 0.9, -4.5)
engine.add(glow)

// Embers drifting past. Sparse and slow — atmosphere, not weather.
const dust = new THREE.Points(
  (() => {
    const count = 120
    const positions = new Float32Array(count * 3)
    for (let i = 0; i < count; i++) {
      positions[i * 3] = math.randSpread(9)
      positions[i * 3 + 1] = math.randRange(0, 7)
      positions[i * 3 + 2] = math.randSpread(6)
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3))
    return geometry
  })(),
  new THREE.PointsMaterial({
    color: new THREE.Color(AMBER),
    size: 0.05,
    map: materials.sparkTexture({ color: "#ffffff" }),
    transparent: true,
    opacity: 0.7,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })
)
engine.add(dust)

createPostFX(engine, {
  bloom: { strength: 0.45, radius: 0.55, threshold: 0.9 },
})

// --- Motion -----------------------------------------------------------------

// Honoured rather than ignored: the page still works, it just stops spinning.
const stillness = matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 1

const dustPositions = dust.geometry.attributes.position.array

engine.onUpdate((dt, elapsed) => {
  mark.rotation.y += dt * 0.55 * stillness
  // A slow nod on top of the spin, so the mark never settles into looking like
  // a looping gif.
  mark.rotation.x = math.DEG * 18 + Math.sin(elapsed * 0.7) * 0.06 * stillness
  mark.position.y = 1.25 + Math.sin(elapsed * 1.1) * 0.09 * stillness
  shadow.update(0)

  glow.intensity = 34 + Math.sin(elapsed * 2.2) * 7

  for (let i = 0; i < dustPositions.length; i += 3) {
    dustPositions[i + 1] += dt * 0.32 * stillness
    // Wrapped rather than respawned, so the field never runs out.
    if (dustPositions[i + 1] > 7) dustPositions[i + 1] = 0
  }
  dust.geometry.attributes.position.needsUpdate = true
})

engine.start()

// --- Words ------------------------------------------------------------------

const copy = document.createElement("main")
copy.className = "welcome"
copy.innerHTML = `
  <h1>New game</h1>
  <p>Nothing has been built yet — describe the game you want.</p>
`
document.body.appendChild(copy)
