import { redirect } from "next/navigation";

import { DemoBadge, DemoBanner } from "@/components/demo-banner";
import { MobileNav } from "@/components/mobile-nav";
import { ShellNav } from "@/components/shell-nav";
import { SignOutButton } from "@/components/sign-out-button";
import { isDemoMode } from "@/lib/config";
import { createClient } from "@/lib/supabase/server";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const demo = isDemoMode();
  let email: string | null = null;

  if (!demo) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) redirect("/login");
    email = user.email ?? null;
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-200">
      <div className="pointer-events-none fixed inset-x-0 top-0 -z-10 h-80 bg-[radial-gradient(60%_100%_at_50%_0%,rgba(99,102,241,0.10),transparent)]" />

      <ShellNav />

      <div className="md:pl-60">
        {demo && <DemoBanner />}

        <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-white/[0.06] bg-zinc-950/70 px-4 backdrop-blur md:px-6">
          <span className="text-base font-semibold tracking-tight text-zinc-100 md:hidden">
            Bet CRM
          </span>
          <span className="hidden text-sm text-zinc-500 md:block">
            Gestione analisi e giocate
          </span>
          <div className="flex items-center gap-3">
            {demo ? (
              <DemoBadge />
            ) : (
              <>
                <span className="hidden text-sm text-zinc-400 sm:block">
                  {email}
                </span>
                <SignOutButton />
              </>
            )}
          </div>
        </header>

        <MobileNav />

        <main className="mx-auto max-w-6xl px-4 py-6 md:px-6 lg:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}
