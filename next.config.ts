import { withSentryConfig } from "@sentry/nextjs/config"
import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  devIndicators: false,
}

export default withSentryConfig(nextConfig, {
  org: "enra-r3",
  project: "sandbox",

  // Build-time secret, used to upload source maps
  authToken: process.env.SENTRY_AUTH_TOKEN,

  // Upload a wider set of client files so stack traces resolve
  widenClientFileUpload: true,

  // Proxy events through the app to sidestep ad-blockers
  tunnelRoute: "/monitoring",

  // Same source as the server-side `release`, so both halves agree
  release: {
    name: process.env.SENTRY_RELEASE ?? process.env.RAILWAY_GIT_COMMIT_SHA,
  },

  silent: !process.env.CI,
})
