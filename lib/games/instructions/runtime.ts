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
- Your own modules load by relative path ("./player.js"), never by package
  name ("three") — there is no node_modules and no import map to resolve one.
- A library has to come from a CDN by full url, loaded by the page.
- Everything runs in the player's browser. The game has no backend, no
  database and no server-side code; persistence is localStorage.

# Assets

The sandbox starts empty, so there is no art or audio to reference — a path to
an image you didn't create is a broken image. Draw graphics in code (canvas,
SVG, CSS) and make sound with the Web Audio API, or fetch from a CDN url you
are certain of.

# Layout

Keep a small game in index.html. As it grows, split it into modules next to it
(./game.js, ./player.js, ./style.css) rather than letting one file sprawl —
you will be reading this code back on every later turn.`
