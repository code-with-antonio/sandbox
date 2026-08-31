import { auth } from "@clerk/nextjs/server"
import { notFound } from "next/navigation"

import { GameChat } from "@/components/game-chat"
import { getGame } from "@/lib/games/queries"

export default async function GamePage({ params }: PageProps<"/games/[id]">) {
  await auth.protect({ unauthenticatedUrl: "/sign-in" })

  const { id } = await params
  const game = await getGame(id)

  if (!game) {
    notFound()
  }

  return (
    <GameChat
      gameId={game.id}
      initialMessages={game.messages}
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
