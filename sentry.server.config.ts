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

  // `release` is deliberately not set here: withSentryConfig injects it at
  // build time, and an explicit `undefined` would overwrite that injection.
  environment:
    process.env.SENTRY_ENVIRONMENT ??
    process.env.RAILWAY_ENVIRONMENT_NAME ??
    process.env.NODE_ENV,
})
