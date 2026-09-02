import { createRequire } from "node:module";
import { join } from "node:path";

import { sentryEsbuildPlugin } from "@sentry/esbuild-plugin";
import { esbuildPlugin } from "@trigger.dev/build/extensions";
import type { BuildExtension } from "@trigger.dev/build/extensions";
import { additionalFiles } from "@trigger.dev/build/extensions/core";
import { defineConfig } from "@trigger.dev/sdk";

// `@daytona/sdk` reaches its heavier dependencies through a `require` held in a
// variable — `form-data` for uploads, `tar` and `fast-glob` for downloads and
// image contexts — which esbuild cannot see and so never pulls into the bundle.
// Locally that require still finds them in `node_modules`; a deployed worker has
// no `node_modules`, so the first `fs.uploadFiles` dies on `Cannot find module
// 'form-data'`. Leaving the package out of the bundle and installing it in the
// deployment instead puts a real `node_modules` back under those requires.
//
// `build.external` is the documented way to do that and does not work here: the
// CLI marks a package external only after reading a name out of the nearest
// package.json to the resolved entry point, and for this SDK that is
// `@daytona/sdk/cjs/package.json` — a two-line `{"type": "commonjs"}` with no
// name — so the entry is dropped without a word and the package is bundled
// anyway. Hence the plugin below, which does the same job by hand.
const daytonaExternal: BuildExtension = {
  name: "daytona-external",
  onBuildStart(context) {
    // Deploy-only: `trigger dev` runs unbundled off the local `node_modules`,
    // which is the arrangement this is recreating.
    if (context.target !== "deploy") {
      return;
    }

    context.registerPlugin(
      {
        name: "daytona-external",
        setup(build) {
          build.onResolve({ filter: /^@daytona\/sdk(\/.*)?$/ }, (args) => ({
            path: args.path,
            external: true,
          }));
        },
      },
      { placement: "first", target: "deploy" },
    );

    // An external is only half the fix — something has to install it. The
    // version is read from the installed package rather than pinned here so a
    // bump in package.json cannot silently deploy an older SDK than the one
    // this was typechecked against.
    const require = createRequire(join(context.workingDir, "package.json"));
    const { version } = require("@daytona/sdk/package.json");

    context.addLayer({
      id: "daytona-external",
      dependencies: { "@daytona/sdk": version },
    });
  },
};

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
    extensions: [
      daytonaExternal,
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
