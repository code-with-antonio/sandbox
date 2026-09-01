/**
 * The 3D toolkit seeded into every sandbox, described for the agent.
 *
 * A reference rather than a tutorial: the agent can read any of these files
 * with `read_file`, but it will only think to do that if it knows what is in
 * them, and a turn spent rediscovering the toolkit is a turn not spent on the
 * game. So the surface is listed here in full, and the prose is spent on the
 * things the signatures don't say — which primitive to reach for, and what
 * goes wrong when you don't.
 *
 * Kept in step with `@/lib/games/runtime/engine` by hand. If a module there
 * grows an export worth using, it belongs in this list too; an undocumented
 * primitive is one the agent will rewrite from scratch.
 */
export const engine = `# The engine

engine/ is a 3D game toolkit, already on disk, built on three.js. It exists
because every browser game needs the same a hundred lines before it needs
anything of its own — colour space, pixel ratio, a resize handler, a delta-timed
loop, input that can tell held from just-pressed — and writing those again per
game is both slower and worse than importing them.

Use it. Reading these instead of reinventing them is the difference between a
first turn that produces a game and one that produces a renderer.

Import from the barrel, which re-exports everything:

  import { createGame, models, lights, materials, math } from "./engine/index.js"

## The whole shape of a game

  import { createGame, models, lights, ease } from "./engine/index.js"

  const game = createGame({
    background: "#0b1020",
    cameraPosition: [0, 6, 12],
    actions: { dash: ["ShiftLeft"] },
  })

  lights.sunset(game.scene)
  game.add(models.ground(80))

  const player = models.character()
  game.add(player)

  game.onUpdate((dt, elapsed) => {
    player.position.x += game.input.move.x * 6 * dt
    if (game.input.pressed("jump")) game.audio.play("jump")
  })

That is a running, lit, input-driven scene. \`createGame\` starts the loop
itself — there is nothing to call afterwards, and no reason for a game to open
on a still frame.

\`createGame(options)\` returns { engine, input, hud, audio, tweens, scene,
camera, renderer, onUpdate, onLateUpdate, onResize, add, remove }.

Options: background, fog ({ color, near, far } or a number for exponential
fog), fov, near, far, cameraPosition, lookAt, shadows, exposure, maxPixelRatio,
antialias, alpha, pauseWhenHidden, actions.

## engine — the loop

\`game.engine\` carries dt, elapsed, frame, fps, paused, and timeScale (set it
to 0.3 for slow motion, 0 to freeze while still rendering).

- onUpdate(fn) — every frame, fn(dt, elapsed). Returns an unsubscribe.
- onLateUpdate(fn) — after every onUpdate. Cameras belong here, so they follow
  where things ended up rather than where they started.
- onResize(fn), start(), stop(), pause(), resume(), dispose().
- disposeObject(obj) — frees the GPU memory behind an object and its children.
  Geometries and textures are not garbage collected; a game that rebuilds a
  level every round leaks until the tab dies without this.

Never write your own requestAnimationFrame loop. dt is already clamped so a
backgrounded tab doesn't return with a two-second frame that throws everything
through the floor.

## input — keyboard, mouse, touch, gamepad

One snapshot per frame, so the game asks questions instead of handling events.

- input.move — Vector2, already normalised, from WASD, arrows, a gamepad stick
  or a thumb drag on the left half of a touch screen. Diagonals are not faster.
- input.down(action) / pressed(action) / released(action). \`pressed\` is true
  for exactly one frame — use it for jumps, shots and menu choices; \`down\` for
  movement. Wiring a jump to \`down\` is what makes a character fly.
- input.axis("left", "right"), input.bind(name, codes), input.press(code).
- input.pointer — Vector2 in clip space, ready for a raycaster.
- input.look — mouse travel this frame; the only thing that works under pointer
  lock. input.requestPointerLock().

Actions already bound: left, right, up, down, jump, fire, sprint, crouch,
pause, restart. Add your own via the \`actions\` option or \`bind\`.

## controls — cameras and characters

Cameras (all smoothed, all framerate-independent):

- followCamera(engine, target, { distance, height, stiffness }) — third-person
  chase, with .shake(amount) for impacts.
- topDownCamera / sideCamera — twin-stick and platformer views. sideCamera has
  a deadzone so small hops don't bob the view.
- orbitCamera(engine, { autoRotate }) — mouse orbit, for menus and viewers.

Controllers (pass a physics \`body\` and they move it; without one they move the
object directly):

- firstPerson(engine, input, { body, speed, jump }) — mouse look, WASD, head bob.
- thirdPerson(engine, input, object, { body }) — moves in camera space and
  turns to face travel. \`.travel\` is 0..1, for driving a walk cycle.
- platformer(engine, input, object, { body }) — with coyote time, a jump buffer
  and variable jump height already in it. These three are what separate a
  platformer that feels tight from one that feels like it drops inputs.
- pointerOnGround(engine, input) — a function returning where the cursor meets
  the ground plane. Aiming, click-to-move, placement.
- pointerPicker(engine, input, objects) — what's under the cursor.

## physics — arcade collision

createPhysics({ gravity }) is not a rigid-body simulation, and does not want to
be. It does the four things games need: don't fall through the floor, don't walk
through walls, slide along them rather than stopping dead, and say when two
things touched.

  const world = createPhysics()
  world.addGround(0)
  world.addBox(wallMesh)          // static, from any mesh's bounding box
  world.addArena(models.arena(40))
  const body = world.addBody({ object: player, radius: 0.5, height: 1.8 })
  game.onUpdate((dt) => world.step(dt))

Bodies are vertical capsules — the shape that rounds a corner and rides a step
without catching. A body has position, velocity, grounded, contacts and onLand.
Set velocity.x/z outright for walking (adding force makes a character coast
after the key is released); set velocity.y once for a jump.

\`addBody({ trigger: true, onEnter, onExit })\` detects without blocking —
pickups, checkpoints, damage zones. Also: world.raycast, world.groundAt (for
terrain the box colliders can't describe), and \`hits(a, b, rA, rB)\` for
bullets that need no body at all.

## models — things to put in the scene

Primitives, shadows already configured: box (with a \`radius\` for rounded
corners), sphere, cylinder, cone, capsule, torus, ground (checkered by default,
because a flat-coloured floor gives the player no sense of speed), arena (four
walls, feedable straight to physics).

Prefabs: crate, coin (spins and hovers), tree, rock (never twice the same),
cloud, vehicle, ring, label (text that always faces the camera), and
character — a blocky humanoid whose .userData.parts holds head, body, arms and
legs, and whose .userData.animate(elapsed, speed) is a walk cycle.

Scale:
- instances(geometry, material, count) — one draw call for thousands of copies,
  with .place(i, position, { scale, rotation }). Grass, stars, bullets, debris.
  A thousand separate meshes is a thousand draw calls and a slideshow.
- merge(meshes) — welds static scenery into one geometry.
- createPool(factory, { size }) — take() and give() instead of new and discard.
  Spawning a bullet per shot allocates, and the collection pause lands as a
  stutter exactly when the screen is busiest.

loadModel(url) and loadTexture(url) exist for a CDN url you are sure of.

## materials — surfaces and textures drawn in code

standard, matte, metal, glow (emissive; pair with bloom), flat (unlit), toon
(cel shading), glass, wireframe, outline(mesh) — a dark backface shell, the
cheapest good outline there is.

There is no art in the sandbox, so textures are generated: checkerTexture,
gridTexture, noiseTexture, gradientTexture, sparkTexture, textTexture, and
skyGradient(scene, top, bottom) — one call, and the single clearest tell of an
unfinished scene is gone.

Colour: \`palette\` (red through violet, plus sand, sky, night), \`brand\` (the
product's own orange), mix(a, b, t), shade(color, amount).

## lights — rigs, not lights

daylight, sunset, night, studio, moody. Each is a complete answer — key, fill,
bounce, and a shadow camera sized to the play area, which is the part that goes
wrong by hand: too big and shadows go blocky, too small and they vanish at the
edge of the level. Pass \`area\` to match your play space.

Also attachLight(object) for a torch or a muzzle flash, and blobShadow(scene,
target) — the cheap round shadow under a character, which reads better than a
shadow map for anything moving fast and costs nothing.

## hud — the DOM over the canvas

createHud(), or \`game.hud\`. Styles are injected, so it looks finished already.
Clicks fall through to the canvas except on buttons.

stat(label, value) — a number that bumps when it changes, which is most of the
feedback a score needs. bar(label, { value, max }) — goes red as it empties.
text, toast (fades itself), banner (big centre punch), overlay({ title, body,
buttons }) for game over and pause, button, crosshair, keys({ WASD: "move" }) —
the fastest way to teach controls without a tutorial — touchButtons, flash(color)
for damage, and marker(engine, target, text) to pin DOM to a world position.

Positions are corners: "top-left", "top-center", "top-right", "center",
"bottom-left", "bottom-center", "bottom-right".

## sound — synthesised, never loaded

createAudio(), or \`game.audio\`. Every sound is generated by the Web Audio API
at the moment it plays, so nothing can fail to load. It unlocks itself on the
player's first interaction, which is a browser rule and the usual reason a game
"has no sound".

audio.play(name) where name is one of: click, blip, select, coin, jump, land,
hit, hurt, laser, shoot, explosion, powerup, win, lose, step, whoosh, thud,
alarm. Pass { vary: 0.1 } on anything that fires repeatedly — repetition is what
makes an effect grating, and a few percent of pitch wander fixes it entirely.

Build your own with tone({ frequency, type, duration, slide }) and
noise({ frequency, sweep }), register it with audio.define(name, fn), and
audio.music.start({ notes, tempo }) for a bed underneath.

## animation — tweens, springs, feedback

createTweens(engine), or \`game.tweens\`.

  await tweens.to(chest.position, { y: 2 }, { duration: 0.4, ease: ease.outBack })

Tweens land on exactly the value asked for and resolve a promise, so sequences
read as await rather than nested callbacks. \`ease\` carries the usual curves;
outBack and outElastic overshoot, which is what makes a pickup or a menu pop
land instead of merely arrive.

Spring / SpringVec3 for a target that keeps moving. createShake(object) for
impacts — 0.15 for a footstep, 0.5 for an explosion, and always over inside
half a second. flash(object) — the emissive blink that makes a hit visible;
without it, damage in 3D is invisible. pop(object, tweens) for squash and
stretch. hover(object) so nothing in the scene is ever perfectly still.
createMixer(model, clips) plays GLTF animations by name with crossfades.

## effects — particles

createParticles(engine, { max }) is one Points object with a fixed buffer, so a
burst of hundreds costs one draw call and zero allocations.

fx.burst(position, { count, color, speed, lifetime }), fx.spray(position,
direction) for muzzle flashes and thrusters, fx.smoke(position),
fx.stream(position, dt, { rate }) for a continuous emitter.

Also shockwave(engine, position) — an expanding ring, which reads far more
clearly than particles for anything with a radius — createTrail(engine, target),
and createAmbience(engine, { follow }) for drifting dust or stars.

## state — the part that isn't 3D

createStateMachine({ playing: { enter, update, exit }, over: {...} }, "playing",
engine) — one named state instead of four booleans, three of which can be true
at once. .go(name) is safe to call from an update.

createScore({ hud }) keeps a high score in localStorage — the whole reason to
replay a small game, and the thing most often forgotten. createStorage(ns) never
throws, so a private window still plays. createTimer, createTicker(interval, fn)
— fires the right number of times whatever the framerate — createCooldown,
createDifficulty (a game whose spawn rate never changes is over as a challenge
the moment it is understood), createEvents, formatTime.

## postfx and debug

createPostFX(engine, { bloom: { strength, threshold } }) — bloom is what makes
an emissive material read as glowing rather than painted bright, and is the
reason neon, lasers and power-ups look like themselves. It turns itself off on
phones, where it costs more than it gives. Keep the threshold high (0.9-ish);
a low one blooms the whole image into fog.

debug.showStats(engine) for fps and draw calls, showHelpers, showColliders. Take
them out before the turn ends.

## math

clamp, lerp, remap, smoothstep, wrap, angleDelta, deadzone, moveTowards,
randRange, randInt, randSpread, pick, shuffle, chance, createRandom(seed) for
levels that differ every run but replay identically, ease, TAU, DEG.

damp(current, target, lambda, dt) and dampVec are the ones to internalise. The
naive \`x += (target - x) * 0.1\` moves ten times further per second at 120fps
than at 12, so a game tuned on one machine feels wrong on another. Anything
smoothed should go through damp.

## Rules

- Import from engine/; don't edit it. If something it does isn't what a game
  needs, wrap it or write the game's own version in the game's own file.
- Read the module before guessing at an API. These files are on disk and
  read_file is cheaper than a broken game.
- Anything moved per frame is multiplied by dt. Anything smoothed goes through
  damp or a spring. No exceptions — both bugs only show up on hardware you
  cannot test on.
- Prefer a primitive over reinventing one: instances over many meshes, a pool
  over spawning, a state machine over booleans, hud over drawing text into 3D.`
