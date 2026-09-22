import Link from "next/link";

import { NewMatchForm } from "@/components/new-match-form";
import { isDemoMode } from "@/lib/config";

export const dynamic = "force-dynamic";

export default function NewMatchPage() {
  const demo = isDemoMode();

  return (
    <div>
      <Link
        href="/dashboard"
        className="text-sm font-medium text-indigo-300 hover:text-indigo-200"
      >
        ← Torna alla dashboard
      </Link>

      <div className="mb-6 mt-4">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-100">
          Nuova partita
        </h1>
        <p className="text-sm text-zinc-500">
          Inserisci la partita e la relativa analisi. Quota equa ed EV vengono
          calcolati automaticamente.
        </p>
      </div>

      <NewMatchForm isDemo={demo} />
    </div>
  );
}
