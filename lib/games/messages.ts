import "server-only"

import { createIdGenerator } from "ai"

// Ids for messages that are persisted without ever passing through the
// client — currently the opening prompt a game is created with. Assistant
// replies are given ids by the chat agent's runtime.
export const generateMessageId = createIdGenerator({ prefix: "msg", size: 16 })
