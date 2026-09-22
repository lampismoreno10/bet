"use client";

import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";

export function SignOutButton() {
  const router = useRouter();

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <button
      onClick={handleSignOut}
      className="rounded-lg px-3 py-1.5 text-sm font-medium text-zinc-400 transition hover:bg-white/5 hover:text-zinc-100"
    >
      Esci
    </button>
  );
}
