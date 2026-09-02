import { PricingTable } from "@clerk/nextjs"
import { auth } from "@clerk/nextjs/server"
import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Billing",
}

// A stand-in balance until credits are metered for real. It reads as a number
// here so the page can be looked at, and nothing else depends on it.
const AVAILABLE_CREDITS = "$8.80"

export default async function BillingPage() {
  await auth.protect({ unauthenticatedUrl: "/sign-in" })

  return (
    <div className="flex min-h-svh flex-col">
      <header className="flex h-12 shrink-0 items-center border-b px-4">
        <span className="font-heading text-sm font-medium">Billing</span>
      </header>
      <div className="mx-auto w-full max-w-3xl px-6 py-10">
        <section>
          <p className="text-sm text-muted-foreground">Available credits</p>
          <p className="mt-1 font-heading text-4xl font-semibold tracking-tight tabular-nums">
            {AVAILABLE_CREDITS}
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
