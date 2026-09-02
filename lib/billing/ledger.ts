import "server-only"

import { auth } from "@clerk/nextjs/server"
import { eq, sql } from "drizzle-orm"

import { creditLedger, db } from "@/lib/db"

/** One dollar, in the billionths the ledger counts in. */
export const DOLLAR = 1_000_000_000n

/**
 * What every organization starts with, before it has paid for anything.
 *
 * This is deliberately *not* a ledger row. A row would have to be written by
 * something, and whatever wrote it would need its own answer for what happens
 * when an org is created outside the app, or when the row is missing because
 * the write failed. Leaving the free credits out of the table makes the
 * question moot: an org with no rows is an org that has spent nothing and been
 * granted nothing, and it reads as exactly $1.00 without anyone having had to
 * write that down.
 */
export const FREE_CREDITS = DOLLAR

/**
 * The active organization's remaining credits, in billionths of a dollar.
 *
 * Negative balances are real and expected — a build already in flight is
 * allowed to finish, and its last steps land after the balance hits zero.
 */
export async function getCreditBalance(): Promise<bigint> {
  const { orgId } = await auth()

  // No active organization means no rows could belong to the caller, which is
  // the same position a brand new org is in.
  if (!orgId) {
    return FREE_CREDITS
  }

  const [row] = await db
    .select({
      // `sum` over `bigint` is `numeric` in Postgres, which node-postgres hands
      // back as a string rather than risk a lossy float. Every input is an
      // integer, so the string is one too and `BigInt` takes it directly.
      total: sql<string | null>`sum(${creditLedger.amount})`,
    })
    .from(creditLedger)
    .where(eq(creditLedger.orgId, orgId))

  // `sum` of no rows is null, not zero.
  return FREE_CREDITS + BigInt(row?.total ?? 0)
}
