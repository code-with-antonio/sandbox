import { GAME_DIR, PREVIEW_PORT } from "@/lib/daytona/utils"

/**
 * The sandbox the game is built in and served from.
 *
 * The directory and port are the ones `@/lib/daytona/utils` actually creates
 * and serves, interpolated rather than restated, so the agent can't be told
 * about a layout the sandbox doesn't have.
 */
export const runtime = `# Where the game lives

Each game has its own Linux sandbox, and it is the same sandbox for the whole
conversation — what you wrote on an earlier turn is still on disk.

The game's source lives in ${GAME_DIR}. That directory is the game: nothing
outside it is served, and nothing that isn't a file in it survives the turn.

${GAME_DIR}/index.html is the entry point — it is what loads at "/", so it has
to exist and has to be the playable game.

# What is already there

A new sandbox is not empty. It starts with:

- index.html — the page, carrying the import map described below.
- style.css — a full-bleed canvas, no scrolling, no tap highlights.
- welcome.js — the holding screen. Delete it and its <script> tag on the first
  turn; it is a placeholder, not part of any game.
- report.js — the error reporter. It catches whatever the page throws and hands
  it to the preview panel, which is how a game that fails to start says so
  instead of showing a black frame. Don't edit it, don't delete it, and leave
  its <script> tag where it is: first in index.html, above the import map and
  above your own scripts, and plain rather than type="module". A reporter that
  loads after the file that broke reports nothing.
- engine/ — a 3D game toolkit, described in its own section. Read that before
  building anything, and do not rewrite these files.

# How it reaches the player

A static file server is already running on port ${PREVIEW_PORT} against that
directory, and the preview panel loads it in an iframe. You never start,
restart or configure a server; one is running before your first turn, and a
second one on that port would only fail to bind.

Files are served exactly as they are written, straight from disk, per request.
There is no build step, no bundler, no transpiler and no package install, and
nothing to restart after an edit — a saved file is live on the next reload.

That means the browser has to understand what you write:

- HTML, CSS and JavaScript that runs as-is. No TypeScript, no JSX, no SCSS.
- Your own modules load by relative path: "./player.js", "./engine/index.js".
- Everything runs in the player's browser. The game has no backend, no
  database and no server-side code; persistence is localStorage.

# three.js, and the import map

index.html declares an import map, so these two specifiers resolve in the
browser with no bundler:

- "three" — the library itself.
- "three/addons/..." — everything under examples/jsm: OrbitControls,
  GLTFLoader, EffectComposer, RoundedBoxGeometry and the rest.

  import * as THREE from "three"
  import { OrbitControls } from "three/addons/controls/OrbitControls.js"

The map only applies to the document that declares it, so it has to stay in
index.html, above the first module script. If you rewrite index.html, carry it
across — along with the report.js tag above it — because without the map every
import of "three" fails and the screen stays blank, including every file under
engine/.

Any other library has to come from a CDN by full url, loaded by the page.

# Assets

Beyond three.js there is no art and no audio in the sandbox, so a path to an
image you didn't create is a broken image. Build models out of geometry
(engine/models.js has a shelf of them), draw textures to a canvas
(engine/materials.js), and synthesise sound (engine/sound.js). Reach for a CDN
url only when you are certain of it.

# Layout

Keep a small game in index.html and one module beside it. As it grows, split it
into more modules next to it (./game.js, ./player.js, ./enemies.js) rather than
letting one file sprawl — you will be reading this code back on every later
turn. Leave engine/ alone and import from it; it is shared ground, and a game
that edits it is a game whose next turn starts by re-reading a toolkit that no
longer matches what you know about it.`
