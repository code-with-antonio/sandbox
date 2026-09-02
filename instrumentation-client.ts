import * as Sentry from "@sentry/nextjs"

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  dataCollection: {
    // Prompts and game source flow through this app's request bodies, so they
    // stay out of Sentry. Everything else uses the permissive defaults.
    httpBodies: [],
  },

  // 100% in dev, 10% in production
  tracesSampleRate: process.env.NODE_ENV === "development" ? 1.0 : 0.1,

  // Session Replay: 10% of all sessions, 100% of sessions with an error
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,

  enableLogs: true,

  // The release is injected into the bundle by withSentryConfig at build time.
  environment:
    process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,

  integrations: [
    Sentry.replayIntegration(),
    // The game runs in a cross-origin iframe, so none of its console output
    // reaches this window — this only picks up the app shell's own, and a
    // dependency's. `runtime/report.js` is what carries the game's failures
    // across, and `ChatPreview` turns those into logs.
    Sentry.consoleLoggingIntegration({ levels: ["warn", "error"] }),
  ],

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

    log.attributes = { ...log.attributes, "service.name": "sandbox-browser" }

    return log
  },
})

// Turns App Router navigations into spans
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart
