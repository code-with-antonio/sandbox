import { PricingTable } from "@clerk/nextjs"
import { auth } from "@clerk/nextjs/server"
import type { Metadata } from "next"

import { formatCredits } from "@/lib/billing/format"
import { getCreditBalance } from "@/lib/billing/ledger"
import { reconcileCredits } from "@/lib/billing/reconcile"

export const metadata: Metadata = {
  title: "Billing",
}

export default async function BillingPage() {
  await auth.protect({ unauthenticatedUrl: "/sign-in" })

  const { orgId } = await auth()

  // This is where someone lands after checkout, so it is where the months an
  // organization has paid for are turned into ledger rows. Reconciling costs a
  // read of the subscription and, all but the first time each month, an insert
  // that conflicts and does nothing.
  if (orgId) {
    await reconcileCredits(orgId)
  }

  const credits = await getCreditBalance(orgId)

  return (
    <div className="flex min-h-svh flex-col">
      <header className="flex h-12 shrink-0 items-center border-b px-4">
        <span className="font-heading text-sm font-medium">Billing</span>
      </header>
      <div className="mx-auto w-full max-w-3xl px-6 py-10">
        <section>
          <p className="text-sm text-muted-foreground">Available credits</p>
          <p className="mt-1 font-heading text-4xl font-semibold tracking-tight tabular-nums">
            {formatCredits(credits)}
          </p>
          <p className="mt-3 max-w-xl text-sm text-balance text-muted-foreground">
            Credits cover the models that build and revise your games. A scene
            already in progress can finish below zero; the next build waits for
            more credits.
          </p>
        </section>
        <section className="mt-10">
          <h2 className="font-heading text-2xl font-semibold tracking-tight">
            Keep the studio running
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Builder adds $10.00 every month, and unused credits roll over.
          </p>
          {/* Plans live on the organization, not the person — the switcher in
              the sidebar footer is what picks which one is being billed. */}
          <div className="mt-6">
            <PricingTable for="organization" />
          </div>
        </section>
      </div>
    </div>
  )
}
