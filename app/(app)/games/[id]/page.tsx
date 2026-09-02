import { auth } from "@clerk/nextjs/server"
import { notFound } from "next/navigation"

import { GameChat } from "@/components/game-chat"
import { DEFAULT_GAME_MODEL_ID, isGameModelId } from "@/lib/games/model-catalog"
import { getGame } from "@/lib/games/queries"

export default async function GamePage({
  params,
  searchParams,
}: PageProps<"/games/[id]">) {
  await auth.protect({ unauthenticatedUrl: "/sign-in" })

  const { id } = await params
  const game = await getGame(id)

  if (!game) {
    notFound()
  }

  // Where the home page's pick lands: `createGame` puts it here rather than on
  // the row, because it is only the thread's starting point — the picker in the
  // thread takes over from it, and the URL is not rewritten when it does. It is
  // also just a query string, so it is checked rather than believed.
  const { model } = await searchParams

  return (
    <GameChat
      gameId={game.id}
      initialMessages={game.messages}
      initialModelId={isGameModelId(model) ? model : DEFAULT_GAME_MODEL_ID}
      sandboxId={game.sandboxId}
      // The chat session the last turn persisted. Absent until a game has had
      // one, and the token may already have expired — the transport refreshes
      // it through the mint action on a 401.
      initialSession={
        game.chatAccessToken
          ? {
              publicAccessToken: game.chatAccessToken,
              lastEventId: game.chatLastEventId ?? undefined,
            }
          : undefined
      }
    />
  )
}
