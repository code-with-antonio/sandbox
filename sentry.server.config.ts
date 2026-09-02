import * as Sentry from "@sentry/nextjs"

Sentry.init({
  dsn: process.env.SENTRY_DSN,

  dataCollection: {
    // Prompts and game source flow through this app's request bodies, so they
    // stay out of Sentry. Everything else uses the permissive defaults.
    httpBodies: [],
  },

  tracesSampleRate: process.env.NODE_ENV === "development" ? 1.0 : 0.1,

  // Attach local variable values to stack frames
  includeLocalVariables: true,

  enableLogs: true,

  integrations: [
    // Nothing in this app logs through `console` directly — everything goes
    // through `Sentry.logger` — but a stray `console.warn` from here or from a
    // dependency is still worth having next to the structured logs rather than
    // only in the platform's stdout. `log`/`info` are left out: they are where
    // build and framework noise lives.
    Sentry.consoleLoggingIntegration({ levels: ["warn", "error"] }),
  ],

  // `trace` and `debug` are development aids. They stay out of production
  // rather than being paid for and then filtered at query time.
  // Two things that have to happen to every log rather than at each call site.
  //
  // `service.name` is here rather than on a scope because scope attributes do
  // not reach logs: as of SDK 10.73 `getGlobalScope().setAttributes({ ... })`
  // applies to spans and events, and a log arrives carrying only what was
  // passed to the `logger` call plus the `sentry.*` keys the SDK adds. This
  // hook is the one place that actually stamps every log.
  //
  // It earns its keep because all four runtimes report into one Sentry project,
  // and two of the modules that log — `@/lib/daytona/utils` and
  // `@/lib/games/tools` — run in more than one of them, emitting the same
  // messages from each.
  beforeSendLog: (log) => {
    // `trace` and `debug` are development aids. They stay out of production
    // rather than being paid for and then filtered at query time.
    if (
      process.env.NODE_ENV === "production" &&
      (log.level === "trace" || log.level === "debug")
    ) {
      return null
    }

    log.attributes = { ...log.attributes, "service.name": "sandbox-web" }

    return log
  },

  // `release` is deliberately not set here: withSentryConfig injects it at
  // build time, and an explicit `undefined` would overwrite that injection.
  environment:
    process.env.SENTRY_ENVIRONMENT ??
    process.env.RAILWAY_ENVIRONMENT_NAME ??
    process.env.NODE_ENV,
})
