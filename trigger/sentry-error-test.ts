import { task } from "@trigger.dev/sdk"

/**
 * Throws on purpose, to prove the Sentry wiring in `init.ts` is live. Retries
 * are off so the failure hook fires on the first attempt instead of a minute
 * of backoff later.
 */
export const sentryErrorTest = task({
  id: "sentry-error-test",
  retry: {
    maxAttempts: 1,
  },
  run: async () => {
    const error = new Error("This is a custom error that Sentry will capture")
    error.cause = { additionalContext: "This is additional context" }
    throw error
  },
})
