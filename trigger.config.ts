import { sentryEsbuildPlugin } from "@sentry/esbuild-plugin";
import { esbuildPlugin } from "@trigger.dev/build/extensions";
import { additionalFiles } from "@trigger.dev/build/extensions/core";
import { defineConfig } from "@trigger.dev/sdk";

export default defineConfig({
  project: "proj_mrgzxrrrlsqxhkxnkflz",
  runtime: "node-24",
  logLevel: "log",
  // The max compute seconds a task is allowed to run. If the task run exceeds this duration, it will be stopped.
  // You can override this on an individual task.
  // See https://trigger.dev/docs/runs/max-duration
  maxDuration: 3600,
  retries: {
    enabledInDev: true,
    default: {
      maxAttempts: 3,
      minTimeoutInMs: 1000,
      maxTimeoutInMs: 10000,
      factor: 2,
      randomize: true,
    },
  },
  dirs: ["trigger"],
  build: {
    // `@daytona/sdk` loads its heavier dependencies through a runtime
    // `require` held in a variable (`form-data` for uploads, `tar` and `fs`
    // for downloads, `fast-glob` for image contexts), which esbuild cannot
    // see and therefore never pulls into the bundle. Locally the require
    // still resolves through `node_modules`; in a deployed worker there is
    // no `node_modules`, so the first upload fails with `Cannot find module
    // 'form-data'`. Left external, the SDK is installed in the deployment
    // instead of bundled and those requires resolve as they do here.
    external: ["@daytona/sdk"],
    extensions: [
      // Nothing imports the sandbox seed files — they are read off disk at
      // runtime by `@/lib/games/seed` — so the bundler never sees them and they
      // have to be copied into the deployment by hand. They land at the same
      // path relative to the deployment root that they have here, which is what
      // that module resolves them from.
      additionalFiles({ files: ["lib/games/runtime/**/*"] }),
      // Uploads source maps for the deployed bundle and injects the matching
      // release into it, so the stack traces Sentry shows for a failed run
      // point at this source rather than at minified worker output. Deploy-only
      // — `trigger dev` runs unbundled and needs neither.
      esbuildPlugin(
        sentryEsbuildPlugin({
          org: process.env.SENTRY_ORG,
          project: process.env.SENTRY_PROJECT,
          authToken: process.env.SENTRY_AUTH_TOKEN,
        }),
        { placement: "last", target: "deploy" },
      ),
    ],
  },
});
