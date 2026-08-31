import {
  PREVIEW_PORT,
  PREVIEW_URL_TTL_SECONDS,
  startGameServer,
} from "@/lib/daytona/utils"
import { getGame } from "@/lib/games/queries"

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
  const { id } = await ctx.params
  const game = await getGame(id)

  if (!game) {
    return Response.json({ error: "Game not found" }, { status: 404 })
  }

  // Null until the thread's first turn creates the sandbox, and for games made
  // before sandboxes existed. Neither has anything to preview yet.
  if (!game.sandboxId) {
    return Response.json({ error: "Game has no sandbox yet" }, { status: 409 })
  }

  const { sandbox } = await startGameServer(game.sandboxId)
  const { url } = await sandbox.getSignedPreviewUrl(
    PREVIEW_PORT,
    PREVIEW_URL_TTL_SECONDS
  )

  return Response.json({ url })
}
