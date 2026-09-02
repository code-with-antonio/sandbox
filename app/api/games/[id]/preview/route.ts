import * as Sentry from "@sentry/nextjs"

import {
  PREVIEW_PORT,
  PREVIEW_URL_TTL_SECONDS,
  startGameServer,
} from "@/lib/daytona/utils"
import { getGame } from "@/lib/games/queries"
import { elapsed } from "@/lib/observability"

/**
 * The url a game's preview iframe loads.
 *
 * The preview panel calls this on mount, so it is also what brings the game's
 * server up: `startGameServer` reuses whatever is already running, and only
 * pays the start-up cost on the first load after a sandbox has gone idle.
 *
 * The url is signed rather than the standard token-authenticated preview link,
 * because it is loaded in an iframe, which cannot send the
 * `x-daytona-preview-token` header the standard link requires.
 *
 * `getGame` resolves the organization from the session and scopes the lookup to
 * it, so a game belonging to another org — or a caller with no session at all —
 * is indistinguishable from a game that doesn't exist.
 */
export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/games/[id]/preview">
) {
  const startedAt = performance.now()
  const { id } = await ctx.params

  // Tags, for the events rather than the logs — a 500 out of `startGameServer`
  // arrives naming the game. Scope attributes would not reach the logs below,
  // which carry the game id themselves.
  Sentry.getIsolationScope().setTags({
    "app.route": "GET /api/games/[id]/preview",
    "game.id": id,
  })

  const game = await getGame(id)

  // Deliberately indistinguishable from another org's game, so the log is the
  // only place the difference is recorded — and the one place a player stuck on
  // "Preview is unavailable" can be told apart from someone walking game ids.
  if (!game) {
    Sentry.logger.warn(
      Sentry.logger
        .fmt`Preview requested for game ${id}, which the caller cannot see`,
      { "game.id": id, "http.response.status_code": 404 }
    )

    return Response.json({ error: "Game not found" }, { status: 404 })
  }

  // Null until the thread's first turn creates the sandbox, and for games made
  // before sandboxes existed. Neither has anything to preview yet.
  if (!game.sandboxId) {
    // Expected on a brand-new game, so not a warning — but a game still
    // answering 409 well after its first turn finished means `onChatStart`
    // never ran, and this is what shows that.
    Sentry.logger.info(
      Sentry.logger
        .fmt`Preview requested for game ${id} before it has a sandbox`,
      { "game.id": id, "http.response.status_code": 409 }
    )

    return Response.json({ error: "Game has no sandbox yet" }, { status: 409 })
  }

  // A throw from here is a 500, which `onRequestError` in `@/instrumentation`
  // already captures with a stack trace — and `startGameServer` logs the reason
  // the start failed on its way past. Nothing to add around it here.
  const { sandbox } = await startGameServer(game.sandboxId)
  const { url } = await sandbox.getSignedPreviewUrl(
    PREVIEW_PORT,
    PREVIEW_URL_TTL_SECONDS
  )

  // The url is signed and the signature rides in the query, so it is a
  // credential — the sandbox id identifies the same thing without being one.
  Sentry.logger.info(Sentry.logger.fmt`Served preview url for game ${id}`, {
    "game.id": id,
    "sandbox.id": game.sandboxId,
    "http.response.status_code": 200,
    duration_ms: elapsed(startedAt),
  })

  return Response.json({ url })
}
