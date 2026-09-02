/**
 * The logging surface for code that runs in more than one runtime.
 *
 * `@/lib/daytona/*` and `@/lib/games/tools` are imported both by the Next
 * server (the preview route) and by the Trigger.dev worker (the chat agent),
 * and those two initialize different SDKs — `@sentry/nextjs` in
 * `sentry.server.config.ts`, `@sentry/node` in `@/trigger/init`. `@sentry/core`
 * is the package underneath both: it holds no client of its own and no
 * import-time side effects, so `logger` here writes to whichever client the
 * runtime happens to have initialized, and is an inert no-op if neither did.
 *
 * `@/trigger/*` uses it for the same reason, and so that a task file logs the
 * same way the modules it calls do. Next-only modules import `@sentry/nextjs`
 * directly instead — the extra indirection buys them nothing, and the client
 * bundle should not reach for anything but its own SDK.
 */
export { logger } from "@sentry/core"

/**
 * A thrown value as log attributes.
 *
 * Attributes take strings, numbers and booleans only, so this is also where a
 * non-`Error` throw — which is anything, in JavaScript — turns into something
 * that can be sent. The stack is deliberately left out: a log that matters
 * enough to need one is a `captureException`, and that carries a real
 * structured stack trace rather than a string.
 */
export function describeError(error: unknown): {
  "exception.type": string
  "exception.message": string
} {
  return {
    "exception.type": error instanceof Error ? error.name : typeof error,
    "exception.message": error instanceof Error ? error.message : String(error),
  }
}

/** Milliseconds since `start`, rounded — the shape every duration is logged in. */
export function elapsed(start: number): number {
  return Math.round(performance.now() - start)
}
