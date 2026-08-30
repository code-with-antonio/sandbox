URL: https://trigger.dev/docs/ai-chat/migrating-from-a-route-handler

Migrate this app's AI chat from a Vercel AI SDK route handler to Trigger.dev `chat.agent`.

Before you edit anything:

1. Run `npx trigger.dev@latest skills`. That installs the `trigger-authoring-chat-agent`
   and `trigger-chat-agent-advanced` skills, which are version-pinned to the
   `@trigger.dev/sdk` in this project, so they describe the exact API surface we have.
   Load both before you plan the change.
2. Read these pages in full:
   - https://trigger.dev/docs/ai-chat/quick-start.md
   - https://trigger.dev/docs/ai-chat/frontend.md
   - https://trigger.dev/docs/ai-chat/reference.md
   Use https://trigger.dev/docs/llms.txt as the index if you need anything else
   (persistence, tools, lifecycle hooks). Do not fetch llms-full.txt.
3. Find and read the current chat code: the `useChat` component, the chat route handler
   (`app/api/chat/route.ts` or equivalent), the tool definitions, and anything that
   persists messages or resumes streams.

Then make these changes:

- Create a `chat.agent` task in `trigger/chat.ts`. Move the existing `streamText` call
  into its `run` function UNCHANGED — same model, same `system`, same `temperature`,
  same `stopWhen`, same provider options. Do not rewrite the prompt or swap the model.
- Spread `...chat.toStreamTextOptions({ tools })` as the FIRST property of that
  `streamText` call, so the explicit options after it still win.
- `run` receives `ModelMessage[]` already. Delete the `convertToModelMessages` call.
- Forward the `signal` from `run` as `abortSignal` so Stop works.
- Move the existing tool set onto `chat.agent({ tools })` as well, and read it back from
  the `run` payload. Keep every tool's schema, `execute`, and `toModelOutput` as-is.
- Add two server actions: `chat.createStartSessionAction("<task-id>")` to start the
  session, and an access-token mint using `auth.createPublicToken` scoped to
  `read: { sessions: chatId }` and `write: { sessions: chatId }`. Move the route
  handler's auth check into them.
- Replace the client's `DefaultChatTransport` / `api` URL with `useTriggerChatTransport`
  from `@trigger.dev/sdk/chat/react`, wired to those two actions. Leave the rest of the
  `useChat` usage and all message rendering alone.
- Move message persistence out of the route handler. If this app's database should stay
  the source of truth for history, use a `hydrateMessages` hook; otherwise persist from
  `onTurnStart` and `onTurnComplete`. Write `lastEventId` alongside the messages in the
  same transaction.
- Delete the route handler, any resumable-stream / Redis stream-resumption plumbing, and
  the separate stream-resume GET route. The transport resumes from `lastEventId`.

Constraints:

- Import from `@trigger.dev/sdk`, `@trigger.dev/sdk/ai`, and `@trigger.dev/sdk/chat/react`.
  Never `@trigger.dev/sdk/v3`.
- Import the agent into client components with `import type` only.
- Never mint a token in the browser or expose `TRIGGER_SECRET_KEY` client-side.
- Do not change the model, prompt, tool schemas, or UI components beyond what the
  transport swap requires.

Do NOT attempt this unless I ask for it separately:

- Head Start (`chat.headStart`), which keeps a route handler around to run the first
  turn's opening model call in the warm server process. It's a follow-on change with its
  own constraint — tool schemas have to be split away from tool executes so the route
  handler's bundle stays light. Read https://trigger.dev/docs/ai-chat/fast-starts.md
  before touching it.

When you're done, list what you deleted and show the diff for the agent task, the server
actions, and the client component.
