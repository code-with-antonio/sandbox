import * as Sentry from "@sentry/node"
import { tasks } from "@trigger.dev/sdk"

/**
 * Loaded automatically before any task in this directory runs, so every worker
 * process gets a Sentry client and the global hooks below.
 *
 * Default integrations are off on purpose: nearly all of them are OpenTelemetry
 * auto-instrumentations, and Trigger.dev already owns the OTel setup inside a
 * run — letting Sentry patch the same libraries fights it for the trace. What
 * stays is the plain error transport and structured logging, which is all this
 * is here for.
 */
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  defaultIntegrations: false,

  // The worker shares `@/lib/daytona/utils` and `@/lib/games/tools` with the
  // Next server, and both log through `Sentry.logger`. Without this those calls
  // are silent no-ops on this side of the fence.
  enableLogs: true,

  // No console integration here, unlike the Next configs: Trigger.dev's own
  // `logger` writes through stdout, so forwarding console would copy the run
  // log into Sentry alongside the structured logs rather than adding anything.
  //
  // The counterpart to `service.name: "sandbox-web"` in
  // sentry.server.config.ts — see the note there for why this is a
  // `beforeSendLog` and not a scope attribute. It is what tells a sandbox
  // failure inside a chat turn apart from one behind a preview request, since
  // both run the same module.
  beforeSendLog: (log) => {
    if (
      process.env.NODE_ENV === "production" &&
      (log.level === "trace" || log.level === "debug")
    ) {
      return null
    }

    log.attributes = { ...log.attributes, "service.name": "sandbox-worker" }

    return log
  },

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

/**
 * One wide event per attempt, whichever way it ended — and, just as importantly,
 * the flush that gets this run's logs out.
 *
 * Logs are batched client-side and sent on a timer, so without this the tail of
 * every run — which is where the interesting part of a failed turn is — would be
 * dropped when the worker exits. `onFailure` only covers a run that ran out of
 * retries; this fires on every attempt, successful ones included.
 */
tasks.onComplete(async ({ task, result, ctx }) => {
  const attributes = {
    "trigger.task_id": task,
    "trigger.run_id": ctx.run.id,
    "trigger.attempt": ctx.attempt.number,
    "trigger.environment": ctx.environment.slug,
    "trigger.environment_type": ctx.environment.type,
  }

  if (result.ok) {
    Sentry.logger.info(Sentry.logger.fmt`Run of ${task} succeeded`, attributes)
  } else {
    // Not a `captureException` — `onFailure` already owns that, and only once
    // the retries are spent. This is the per-attempt record, so a run that
    // recovers on attempt 2 still leaves a trace of the attempt that didn't.
    Sentry.logger.error(Sentry.logger.fmt`Run of ${task} failed`, {
      ...attributes,
      "error.message":
        result.error instanceof Error
          ? result.error.message
          : String(result.error),
    })
  }

  await Sentry.flush(2000)
})
