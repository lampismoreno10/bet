import { redirect } from "next/navigation";

import { LoginForm } from "@/components/login-form";
import { isDemoMode } from "@/lib/config";

export default function LoginPage() {
  // In modalità DEMO non serve autenticazione.
  if (isDemoMode()) redirect("/dashboard");

  return (
    <main className="relative flex min-h-screen items-center justify-center bg-zinc-950 p-6">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-80 bg-[radial-gradient(60%_100%_at_50%_0%,rgba(99,102,241,0.14),transparent)]" />
      <LoginForm />
    </main>
  );
}
