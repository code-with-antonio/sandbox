import { auth } from "@clerk/nextjs/server"

import { ChatThread } from "@/components/chat-thread"

export default async function GamePage() {
  await auth.protect({ unauthenticatedUrl: "/sign-in" })

  return <ChatThread />
}
