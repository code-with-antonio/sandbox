import {
  createClerkClient,
  type BillingSubscriptionItem,
  type ClerkClient,
} from "@clerk/backend"

import { DOLLAR } from "@/lib/billing/format"
// Imported straight from `./client` rather than `@/lib/db`, and taking an
// explicit `orgId`: the chat agent reconciles too, from inside the Trigger.dev
// worker, where the `server-only` marker would throw and there is no session.
import { creditLedger, db } from "@/lib/db/client"
import { describeError, logger } from "@/lib/observability"

/**
 * Clerk's backend client, built here rather than taken from
 * `@clerk/nextjs/server`.
 *
 * `clerkClient()` from the Next package reads request-scoped configuration and
 * is not available in the worker; this one is constructed from the secret key
 * alone and works in both runtimes. Built once, on first use rather than at
 * import, so a module graph that merely mentions billing does not demand the
 * key be present.
 */
let client: ClerkClient | undefined

function clerk(): ClerkClient {
  client ??= createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY })

  return client
}

/** What a paid month is worth, matching the Builder plan's description. */
const MONTHLY_GRANT = 10n * DOLLAR

/**
 * The states in which a subscription item has been paid for at least once.
 *
 * `past_due` and the terminal states are included on purpose: a renewal that
 * failed in month four does not unmake the three months that were paid, and
 * how far the grants run is decided by `paidThrough` below rather than by the
 * status. The three states left out — `upcoming`, `incomplete` and
 * `abandoned` — are the ones where no money has changed hands at all.
 */
const PAID_STATUSES = new Set<BillingSubscriptionItem["status"]>([
  "active",
  "past_due",
  "canceled",
  "ended",
  "expired",
])

/**
 * Whole months from `from` to `to`, by the calendar rather than by elapsed
 * milliseconds — a subscription that renews on the 31st renews in February
 * too, and no fixed number of days describes that.
 */
function monthsElapsed(from: Date, to: Date): number {
  const months =
    (to.getUTCFullYear() - from.getUTCFullYear()) * 12 +
    (to.getUTCMonth() - from.getUTCMonth())

  // The month boundary is the day-of-month the subscription started on, so a
  // calendar month that has turned over but not yet reached that day is not a
  // month that has been billed.
  return to.getUTCDate() < from.getUTCDate() ? months - 1 : months
}

/**
 * The moment a subscription item stops accruing paid months.
 *
 * An item that ended stops there; an item whose renewal failed stops at the
 * failure. Anything still in good standing accrues up to now.
 */
function paidThrough(item: BillingSubscriptionItem): number {
  return Math.min(item.endedAt ?? item.pastDueAt ?? Date.now(), Date.now())
}

/**
 * The ledger rows a subscription item has earned, from its first month to its
 * most recent.
 *
 * Every month is emitted on every pass, not just the newest one, so an
 * organization that subscribed and then did not open the app for a quarter is
 * credited for the quarter it paid for rather than for the visit. The rows
 * already in the table are what stops that from paying twice — the entry key
 * is derived from the item and the month index, both fixed for the life of the
 * subscription, so re-deriving a month that has already been granted produces
 * the same key and the unique index rejects it.
 */
function grantsFor(orgId: string, item: BillingSubscriptionItem) {
  // A free plan is a subscription like any other — every organization has one
  // from the moment it is created — and it has bought nothing.
  if (!item.plan?.hasBaseFee || !PAID_STATUSES.has(item.status)) {
    return []
  }

  // A trial is the plan without the payment.
  if (item.isFreeTrial) {
    return []
  }

  // The first month is paid at signup, so an item that has not yet reached its
  // second month has still earned one grant. Annual plans fall out of the same
  // arithmetic: twelve months are paid up front, and the credits for them
  // accrue a month at a time over the year rather than landing at once.
  const months =
    monthsElapsed(new Date(item.createdAt), new Date(paidThrough(item))) + 1

  return Array.from({ length: Math.max(months, 0) }, (_, index) => ({
    orgId,
    entryKey: `subscription:${item.id}:month:${index}`,
    amount: MONTHLY_GRANT,
  }))
}

/**
 * Credits an organization for every month of its subscription.
 *
 * Safe to call on every page load: it grants a given month exactly once, no
 * matter how many times it runs or how many run at the same time. A failure
 * here is deliberately not thrown — a Clerk outage should leave the balance
 * showing what the ledger already holds, not take down the page that lets
 * someone top up, or the build that is already paid for.
 */
export async function reconcileCredits(orgId: string): Promise<void> {
  try {
    const subscription =
      await clerk().billing.getOrganizationBillingSubscription(orgId)

    const grants = subscription.subscriptionItems.flatMap((item) =>
      grantsFor(orgId, item)
    )

    if (grants.length === 0) {
      return
    }

    await db.insert(creditLedger).values(grants).onConflictDoNothing()
  } catch (error) {
    logger.error("Could not reconcile credits against the subscription", {
      "organization.id": orgId,
      ...describeError(error),
    })
  }
}
