import { auth } from "@clerk/nextjs/server"
import { notFound } from "next/navigation"

import { getCreditBalance } from "@/lib/billing/ledger"
import { GameChat } from "@/components/game-chat"
import { GameMenu } from "@/components/game-menu"
import { DEFAULT_GAME_MODEL_ID, isGameModelId } from "@/lib/games/model-catalog"
import { getGame } from "@/lib/games/queries"

export default async function GamePage({
  params,
  searchParams,
}: PageProps<"/games/[id]">) {
  await auth.protect({ unauthenticatedUrl: "/sign-in" })

  const { orgId } = await auth()
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
    <div className="flex h-svh flex-col">
      <header className="flex h-12 shrink-0 items-center justify-between gap-2 border-b px-4">
        <span className="truncate font-heading text-sm font-medium">
          {game.title}
        </span>
        <GameMenu gameId={game.id} title={game.title} />
      </header>
      <GameChat
        gameId={game.id}
        // What the thread opens with. It goes stale as the turn spends, which is
        // why it only decides whether to *offer* a turn — the agent decides
        // whether to run one, and says so itself when it won't.
        credits={await getCreditBalance(orgId)}
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
    </div>
  )
}
