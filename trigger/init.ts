import * as Sentry from "@sentry/node"
import { tasks } from "@trigger.dev/sdk"

/**
 * Loaded automatically before any task in this directory runs, so every worker
 * process gets a Sentry client and the global failure hook below.
 *
 * Default integrations are off on purpose: nearly all of them are OpenTelemetry
 * auto-instrumentations, and Trigger.dev already owns the OTel setup inside a
 * run — letting Sentry patch the same libraries fights it for the trace. What
 * stays is the plain error transport, which is all this is here for.
 */
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  defaultIntegrations: false,

  // `release` is left unset: the esbuild plugin in trigger.config.ts injects
  // the same version it uploads source maps under at deploy time.
  environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
})

/**
 * Fires once per run, after every retry is exhausted — so a task that fails and
 * then succeeds on attempt 2 never reaches Sentry.
 *
 * Note this doesn't cover crashed, system-failure or canceled runs; those never
 * reach a task's failure hooks at all.
 */
tasks.onFailure(async ({ payload, error, ctx }) => {
  Sentry.captureException(error, (scope) => {
    // The Trigger.dev environment is only knowable per run — the same deployed
    // bundle serves preview branches — so it's stamped here rather than at init.
    scope.addEventProcessor((event) => {
      event.environment = ctx.environment.slug
      return event
    })

    scope.setTags({
      "trigger.task_id": ctx.task.id,
      "trigger.run_id": ctx.run.id,
      "trigger.attempt": ctx.attempt.number,
      "trigger.environment_type": ctx.environment.type,
    })

    scope.setContext("trigger", { ...ctx })
    scope.setExtra("payload", payload)

    return scope
  })

  // The worker is torn down as soon as the run settles, so the event has to be
  // on the wire before this hook returns.
  await Sentry.flush(2000)
})
