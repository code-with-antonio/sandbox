import { AppSidebar } from "@/components/app-sidebar"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { getCreditBalance } from "@/lib/billing/ledger"
import { listGames } from "@/lib/games/queries"

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const [games, credits] = await Promise.all([listGames(), getCreditBalance()])

  return (
    <SidebarProvider>
      <AppSidebar games={games} credits={credits} />
      <SidebarInset>{children}</SidebarInset>
    </SidebarProvider>
  )
}
