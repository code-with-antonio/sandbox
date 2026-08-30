import { parseEnv } from "@neon/env"
import { drizzle } from "drizzle-orm/node-postgres"
import { Pool } from "pg"

import neonConfig from "@/neon"

import * as schema from "./schema"

// Pooled connection (PgBouncer) — the right one for request traffic.
const { postgres } = parseEnv(neonConfig, ["DATABASE_URL"])

// Reuse the pool across hot reloads in dev so we don't exhaust connections.
const globalForDb = globalThis as unknown as { pool?: Pool }

const pool =
  globalForDb.pool ?? new Pool({ connectionString: postgres.databaseUrl })

if (process.env.NODE_ENV !== "production") {
  globalForDb.pool = pool
}

export const db = drizzle(pool, { schema })

export * from "./schema"
