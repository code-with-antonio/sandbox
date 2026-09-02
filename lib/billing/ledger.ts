import { eq, sql } from "drizzle-orm"

// Imported straight from `./client` rather than `@/lib/db`, and taking an
// explicit `orgId` rather than reading Clerk's: `chargeStep` runs inside the
// Trigger.dev worker, where the `server-only` marker on the `@/lib/db` entry
// would throw and where there is no session to read an org from.
import { creditLedger, db } from "@/lib/db/client"
import { DOLLAR } from "@/lib/billing/format"
import { reconcileCredits } from "@/lib/billing/reconcile"

export { DOLLAR }

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
 * An organization's remaining credits, in billionths of a dollar.
 *
 * Takes the org rather than reading it from Clerk so that the one caller
 * without a session — the chat agent — can use the same function. An absent
 * org is accepted because a signed-in user with no active organization is a
 * real state, and it reads the same as an org that has no rows.
 *
 * Negative balances are real and expected — a build already in flight is
 * allowed to finish, and its last steps land after the balance hits zero.
 */
export async function getCreditBalance(
  orgId: string | null | undefined
): Promise<bigint> {
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

/**
 * Bills an organization for one step of a turn.
 *
 * `amount` is what the step cost — a positive number — and is stored negated,
 * because the ledger holds movements rather than debts and a balance is their
 * sum.
 *
 * The response id is what makes this safe to call more than once. A step that
 * is retried, or a turn recovered onto a fresh worker after a crash, replays
 * the same response id, produces the same entry key, and is rejected by the
 * unique index rather than billed again.
 */
export async function chargeStep({
  orgId,
  responseId,
  amount,
}: {
  orgId: string
  responseId: string
  amount: bigint
}): Promise<void> {
  // A step that cost nothing — no usage reported, or a turn stopped before the
  // model ran — is not a row worth writing.
  if (amount <= 0n) {
    return
  }

  await db
    .insert(creditLedger)
    .values({ orgId, entryKey: `step:${responseId}`, amount: -amount })
    .onConflictDoNothing()
}

/**
 * What both gates say when an organization is out of credits.
 *
 * One wording, in the one module both of them already depend on. The agent's
 * copy reaches the player verbatim, over the chat stream; the Server Action's
 * copy may not survive the trip, which is why the thread decides what to show
 * from the balance it was rendered with rather than from this string.
 */
export const OUT_OF_CREDITS =
  "This organization is out of credits. Add more from the billing page to keep building."

/**
 * Whether an organization can start work.
 *
 * An empty balance is not taken at face value. Credits arrive by the month, and
 * the only thing that turns a renewal into a ledger row is a reconcile — so an
 * org that looks broke may simply not have been looked at since its month
 * turned over. That is checked here, once, and only when the balance says no:
 * a paying org is never made to wait on a Clerk round-trip, and an org that is
 * genuinely out does not repeat one on every turn of a dead thread.
 *
 * This gates the *start* of work, never its middle. A build already running is
 * allowed to finish and to end up below zero — the alternative is a game left
 * half-written, which costs the same and leaves nothing behind.
 */
export async function hasCreditsToBuild(orgId: string): Promise<boolean> {
  if ((await getCreditBalance(orgId)) > 0n) {
    return true
  }

  await reconcileCredits(orgId)

  return (await getCreditBalance(orgId)) > 0n
}
