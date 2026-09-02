import "server-only"

import * as Sentry from "@sentry/nextjs"
import { runs, sessions } from "@trigger.dev/sdk"

import { describeError } from "@/lib/observability"

/**
 * Ends a game's chat session and whatever run it has going.
 *
 * The session outlives the page, so deleting a game has to reach into
 * Trigger.dev as well as the database: a turn left streaming would keep calling
 * tools against a game that no longer exists, keep billing the org for it, and
 * — until the row is gone — could still create a sandbox nothing points at.
 *
 * The cancel comes first because closing does not stop a run: it flips
 * `closedAt` so further messages are rejected, which settles the next turn and
 * not the current one. Closing is terminal and the chat id is the game id, so
 * this is one-way — that is fine for a game being deleted and wrong for
 * anything else.
 *
 * Nothing here throws. Every failure leaves a session that is already unusable
 * — its game is about to go — and the delete it belongs to has more important
 * work behind it.
 */
export async function endGameChatSession(gameId: string): Promise<void> {
  let currentRunId: string | null | undefined

  try {
    ;({ currentRunId } = await sessions.retrieve(gameId))
  } catch (error) {
    // The ordinary case for a game deleted before anyone sent a message: no
    // thread was ever started, so there is no session row to retrieve. Debug
    // rather than warn, since it is as common as the success path.
    Sentry.logger.debug(
      Sentry.logger.fmt`No chat session to end for game ${gameId}`,
      { "game.id": gameId, ...describeError(error) }
    )

    return
  }

  if (currentRunId) {
    try {
      await runs.cancel(currentRunId)
    } catch (error) {
      // Usually a run that finished between the retrieve above and this call,
      // which is the outcome we wanted anyway. A run of these is not: it means
      // deletes are leaving live turns behind, spending credits on games that
      // are gone.
      Sentry.logger.warn(
        Sentry.logger
          .fmt`Could not cancel run ${currentRunId} of deleted game ${gameId}`,
        { "game.id": gameId, "run.id": currentRunId, ...describeError(error) }
      )
    }
  }

  try {
    await sessions.close(gameId, { reason: "game deleted" })
  } catch (error) {
    // The session is keyed on the game id, and that id is about to belong to
    // nothing, so a session left open is unreachable rather than harmful.
    Sentry.logger.warn(
      Sentry.logger
        .fmt`Could not close the chat session of deleted game ${gameId}`,
      { "game.id": gameId, ...describeError(error) }
    )
  }
}
