"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { analyzeMatches, runFullPipeline, updateResults } from "@/app/(dashboard)/analysis-actions";
import { syncFixtures } from "@/app/(dashboard)/sync-actions";
import { formatDateTime } from "@/lib/format";
import type {
  AnalysisOutcome,
  ResultsOutcome,
  SyncOutcome,
} from "@/types";

type Tone = "ok" | "error" | "partial";

interface OpResult {
  message: string;
  tone: Tone;
  detail?: string;
}

interface ControlStatus {
  lastSyncAt: string | null;
  lastAnalysisAt: string | null;
  todayRequests: number;
  quotaRemaining: number | null;
  quotaLimit: number | null;
  lastSyncFound: number | null;
  lastAnalysisAnalyzed: number | null;
  lastAnalysisCreated: number | null;
  lastError: string | null;
}

function syncResult(res: SyncOutcome): OpResult {
  const tone: Tone =
    res.status === "ok" ? "ok" : res.status === "quota_exceeded" ? "partial" : "error";
  return {
    message: res.message,
    tone,
    detail: `Richieste API: ${res.requestsUsed} · quota residua: ${
      res.requestsRemaining ?? "?"
    }${res.requestsLimit != null ? ` / ${res.requestsLimit}` : ""}`,
  };
}

function analysisResult(res: AnalysisOutcome): OpResult {
  return {
    message: res.message,
    tone: res.status === "ok" ? "ok" : res.status === "partial" ? "partial" : "error",
    detail: `Richieste API: ${res.requestsUsed} · DeepSeek: ${res.deepseekCalls} · analisi create: ${res.analysesCreated}${
      res.errors.length ? ` · errori: ${res.errors.length}` : ""
    }`,
  };
}

function resultsResult(res: ResultsOutcome): OpResult {
  return {
    message: res.message,
    tone: res.ok ? "ok" : "error",
    detail: `Richieste API: ${res.requestsUsed} · aggiornate: ${res.updated} · terminate: ${res.finished}`,
  };
}

const TONE_STYLES: Record<Tone, string> = {
  ok: "border-emerald-500/20 bg-emerald-500/10 text-emerald-300",
  error: "border-rose-500/20 bg-rose-500/10 text-rose-300",
  partial: "border-amber-500/20 bg-amber-500/10 text-amber-300",
};

export function ControlPanel({
  isAdmin,
  pendingAnalysisCount,
  status,
}: {
  isAdmin: boolean;
  pendingAnalysisCount: number;
  status: ControlStatus;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, OpResult>>({});
  const [confirmOpen, setConfirmOpen] = useState(false);

  async function run(key: string, fn: () => Promise<unknown>, finalize: (r: any) => OpResult) {
    setBusy(key);
    setResults((prev) => ({ ...prev, [key]: { message: "In esecuzione…", tone: "partial" } }));
    try {
      const res = await fn();
      setResults((prev) => ({ ...prev, [key]: finalize(res) }));
      router.refresh();
    } catch {
      setResults((prev) => ({
        ...prev,
        [key]: { message: "Errore imprevisto. Riprova.", tone: "error" },
      }));
    } finally {
      setBusy(null);
    }
  }

  if (!isAdmin) {
    return (
      <div className="card p-5">
        <h2 className="text-sm font-semibold tracking-tight text-zinc-100">Controllo BET</h2>
        <p className="mt-2 text-sm text-zinc-500">
          Solo un amministratore può eseguire queste operazioni.
        </p>
      </div>
    );
  }

  const btn = (key: string) => ({
    disabled: busy !== null,
    className: `rounded-lg px-3 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${
      busy === key ? "bg-indigo-400 text-white" : "bg-indigo-500 text-white hover:bg-indigo-400"
    }`,
    label: busy === key ? "In esecuzione…" : undefined,
  });

  const a = btn("sync");
  const b = btn("analyze");
  const c = btn("full");
  const d = btn("results");

  return (
    <div className="card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold tracking-tight text-zinc-100">Controllo BET</h2>
          <p className="text-xs text-zinc-500">Operazioni manuali su partite e analisi</p>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <button disabled={a.disabled} className={a.className} onClick={() => run("sync", syncFixtures, syncResult)}>
          {a.label ?? "Aggiorna partite"}
        </button>
        <button disabled={b.disabled} className={b.className} onClick={() => run("analyze", analyzeMatches, analysisResult)}>
          {b.label ?? "Analizza partite"}
        </button>
        <button
          disabled={c.disabled}
          className={c.className}
          onClick={() => setConfirmOpen(true)}
        >
          {c.label ?? "Aggiorna + Analizza"}
        </button>
        <button disabled={d.disabled} className={d.className} onClick={() => run("results", updateResults, resultsResult)}>
          {d.label ?? "Aggiorna risultati"}
        </button>
      </div>

      {/* Stato operazioni */}
      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatusItem label="Ultimo aggiornamento" value={status.lastSyncAt ? formatDateTime(status.lastSyncAt) : "—"} />
        <StatusItem label="Richieste oggi" value={String(status.todayRequests)} />
        <StatusItem
          label="Quota residua"
          value={status.quotaRemaining != null ? `${status.quotaRemaining}${status.quotaLimit != null ? ` / ${status.quotaLimit}` : ""}` : "—"}
        />
        <StatusItem label="Partite trovate" value={status.lastSyncFound != null ? String(status.lastSyncFound) : "—"} />
        <StatusItem label="Partite analizzate" value={status.lastAnalysisAnalyzed != null ? String(status.lastAnalysisAnalyzed) : "—"} />
        <StatusItem label="Analisi create" value={status.lastAnalysisCreated != null ? String(status.lastAnalysisCreated) : "—"} />
        <StatusItem label="In attesa di analisi" value={String(pendingAnalysisCount)} />
        <StatusItem label="Ultima analisi" value={status.lastAnalysisAt ? formatDateTime(status.lastAnalysisAt) : "—"} />
      </div>

      {status.lastError && (
        <p className="mt-3 rounded-lg border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
          Ultimo errore: {status.lastError}
        </p>
      )}

      {results.sync && <ResultBox result={results.sync} />}
      {results.analyze && <ResultBox result={results.analyze} />}
      {results.full && <ResultBox result={results.full} />}
      {results.results && <ResultBox result={results.results} />}

      {/* Conferma "Aggiorna + Analizza" */}
      {confirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-zinc-900 p-6 shadow-2xl">
            <h3 className="text-base font-semibold text-zinc-100">Avviare l&apos;analisi completa?</h3>
            <p className="mt-2 text-sm text-zinc-400">
              Stai per avviare l&apos;analisi. Partite da elaborare:{" "}
              <span className="font-semibold text-zinc-100">{pendingAnalysisCount}</span>.
            </p>
            <p className="mt-2 text-xs text-zinc-500">
              L&apos;operazione esegue prima l&apos;import delle partite, poi l&apos;analisi delle
              candidate. Consuma richieste API e chiamate a DeepSeek.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setConfirmOpen(false)} className="btn-ghost">
                Annulla
              </button>
              <button
                className="btn-primary"
                disabled={busy !== null}
                onClick={() => {
                  setConfirmOpen(false);
                  run("full", runFullPipeline, analysisResult);
                }}
              >
                Conferma
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatusItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-white/[0.03] p-3">
      <p className="label">{label}</p>
      <p className="mt-1 truncate text-sm font-semibold tabular-nums text-zinc-100">{value}</p>
    </div>
  );
}

function ResultBox({ result }: { result: OpResult }) {
  return (
    <div className={`mt-3 rounded-xl border px-4 py-3 text-sm ${TONE_STYLES[result.tone]}`}>
      <p>{result.message}</p>
      {result.detail && <p className="mt-1 text-xs opacity-80">{result.detail}</p>}
    </div>
  );
}
