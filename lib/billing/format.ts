/**
 * Credit amounts are stored as billionths of a dollar (see `credit_ledger`), a
 * unit small enough that a single model call rounds to nothing. Rendering is
 * the one place that has to collapse them back to money people recognise, so
 * it lives here rather than in any one component — the sidebar badge and the
 * billing page have to agree, and this module is safe to import from either
 * side of the server/client boundary.
 */

/**
 * One dollar, in the billionths every amount in this app is counted in.
 *
 * It lives here, in the module with no dependencies of its own, because both
 * halves of the money story need it — the ledger to size a grant, the price
 * table to quote a rate — and neither should have to import the other to say
 * what a dollar is.
 */
export const DOLLAR = 1_000_000_000n

const BILLIONTHS_PER_CENT = DOLLAR / 100n

const dollars = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
})

/**
 * An amount in billionths of a dollar as a dollar string, e.g. `"$8.80"`.
 *
 * Rounds to the nearest cent, half away from zero, so a balance is never shown
 * as a whole cent more or less than it rounds to and `-$0.01` keeps its sign.
 * The arithmetic stays in `bigint` until the value is down to cents, where it
 * is far inside the safe integer range and `Intl` can take over.
 */
export function formatCredits(amount: bigint): string {
  const sign = amount < 0n ? -1n : 1n
  const magnitude = amount * sign

  // Add half a cent before truncating, which rounds the magnitude up at the
  // halfway point — and because the sign was factored out first, that is half
  // away from zero rather than half up.
  const cents = (magnitude + BILLIONTHS_PER_CENT / 2n) / BILLIONTHS_PER_CENT

  return dollars.format(Number(cents * sign) / 100)
}
