"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { syncFixtures } from "@/app/(dashboard)/sync-actions";
import { formatDateTime } from "@/lib/format";
import type { SyncOutcome, SyncRun } from "@/types";

const STATUS_STYLES: Record<string, string> = {
  ok: "border-emerald-500/20 bg-emerald-500/10 text-emerald-300",
  error: "border-rose-500/20 bg-rose-500/10 text-rose-300",
  quota_exceeded: "border-amber-500/20 bg-amber-500/10 text-amber-300",
};

export function SyncFixturesPanel({
  isAdmin,
  lastRun,
  todayRequests,
}: {
  isAdmin: boolean;
  lastRun: SyncRun | null;
  todayRequests: number;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [outcome, setOutcome] = useState<SyncOutcome | null>(null);

  async function handleClick() {
    setPending(true);
    setOutcome(null);
    try {
      const res = await syncFixtures();
      setOutcome(res);
      if (res.ok) router.refresh();
    } catch {
      setOutcome({
        ok: false,
        status: "error",
        message: "Errore imprevisto durante l'aggiornamento. Riprova.",
        requestsUsed: 0,
        requestsLimit: null,
        requestsRemaining: null,
        fixturesFound: 0,
        fixturesImported: 0,
        fixturesInserted: 0,
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="card p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold tracking-tight text-zinc-100">
            Pipeline partite
          </h2>
          <p className="text-xs text-zinc-500">
            Importa da API-Football le partite di oggi dei campionati seguiti.
          </p>
        </div>

        {isAdmin ? (
          <button
            onClick={handleClick}
            disabled={pending}
            className="btn-primary"
            title="Consuma 1 richiesta API"
          >
            {pending ? "Aggiornamento…" : "Aggiorna partite"}
          </button>
        ) : (
          <span className="text-xs text-zinc-500">
            Solo un amministratore può aggiornare le partite.
          </span>
        )}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Info
          label="Ultimo aggiornamento"
          value={lastRun ? formatDateTime(lastRun.createdAt) : "—"}
        />
        <Info
          label="Nuove ultimo run"
          value={lastRun ? String(lastRun.fixturesInserted) : "—"}
        />
        <Info label="Richieste oggi" value={String(todayRequests)} />
        <Info
          label="Quota residua"
          value={
            lastRun?.requestsRemaining != null
              ? lastRun.requestsLimit != null
                ? `${lastRun.requestsRemaining} / ${lastRun.requestsLimit}`
                : String(lastRun.requestsRemaining)
              : "—"
          }
        />
      </div>

      {outcome && (
        <div
          className={`mt-4 rounded-xl border px-4 py-3 text-sm ${
            STATUS_STYLES[outcome.status] ?? STATUS_STYLES.error
          }`}
        >
          <p>{outcome.message}</p>
          <p className="mt-2 text-xs opacity-80">
            Nuove: {outcome.fixturesInserted} · gestite: {outcome.fixturesImported}{" "}
            · richieste API consumate: {outcome.requestsUsed}
            {outcome.requestsRemaining != null &&
              ` · quota residua: ${outcome.requestsRemaining}${
                outcome.requestsLimit != null ? ` / ${outcome.requestsLimit}` : ""
              }`}
          </p>
        </div>
      )}
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-white/[0.03] p-3">
      <p className="label">{label}</p>
      <p className="mt-1 truncate text-sm font-semibold tabular-nums text-zinc-100">
        {value}
      </p>
    </div>
  );
}
