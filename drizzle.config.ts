import { config } from "dotenv"

config({ path: ".env.local" })

import { parseEnv } from "@neon/env"
import { defineConfig } from "drizzle-kit"

import neonConfig from "./neon"

// Direct (unpooled) connection — schema pushes must not go through PgBouncer.
const { postgres } = parseEnv(neonConfig, ["DATABASE_URL_UNPOOLED"])

export default defineConfig({
  schema: "./lib/db/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: postgres.databaseUrlUnpooled,
  },
})
