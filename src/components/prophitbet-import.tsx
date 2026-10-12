"use client";

import { useMemo, useState } from "react";
import {
  buildProphitBetDouble,
  buildProphitBetPicks,
  parseProphitBetCsv,
  prophitBetPredictionKey,
  type ProphitBetPrediction,
  type ProphitBetWarning,
} from "@/lib/sports/prophitbet";

type ImportRow = {
  file: string;
  date: string;
  predictions: ProphitBetPrediction[];
  warnings: ProphitBetWarning[];
};

function localDate(): string {
  const d = new Date();
  return [
    d.getFullYear(), String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
  ].join("-");
}

const MARKET_LABELS: Record<string, string> = {
  "1": "Vittoria casa",
  X: "Pareggio",
  "2": "Vittoria trasferta",
  "1X": "1X",
  X2: "X2",
  "12": "12",
  UNDER_2_5: "Under 2,5",
  OVER_2_5: "Over 2,5",
};

export function ProphitBetImport() {
  const [date, setDate] = useState(localDate);
  const [imports, setImports] = useState<ImportRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const predictions = useMemo(() => {
    const map = new Map<string, ProphitBetPrediction>();
    for (const row of imports) {
      for (const prediction of row.predictions) {
        map.set(prophitBetPredictionKey(prediction), prediction);
      }
    }
    return Array.from(map.values());
  }, [imports]);

  const warnings = imports.flatMap((row) => row.warnings);
  const picks = useMemo(() => buildProphitBetPicks(predictions), [predictions]);
  const suggestion = useMemo(() => buildProphitBetDouble(picks), [picks]);

  async function importFiles(files: FileList | null) {
    if (!files?.length) return;
    setError(null);
    setBusy(true);
    try {
      if (files.length > 20) throw new Error("Importa al massimo 20 CSV per volta.");
      const incoming: ImportRow[] = [];
      for (const file of Array.from(files)) {
        if (!file.name.toLowerCase().endsWith(".csv")) {
          throw new Error("File non supportato: seleziona i CSV esportati da ProphitBet.");
        }
        if (file.size > 1_000_000) {
          throw new Error("CSV troppo grande (massimo 1 MB per file).");
        }
        const parsed = parseProphitBetCsv(await file.text(), file.name, date);
        incoming.push({
          file: file.name,
          date,
          predictions: parsed.predictions,
          warnings: parsed.warnings,
        });
      }
      setImports((previous) => [...previous, ...incoming].slice(-20));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Importazione fallita.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="card space-y-4 p-5">
        <h2 className="text-lg font-semibold text-zinc-100">Importa le previsioni ProphitBet</h2>
        <p className="text-sm text-zinc-400">
          In ProphitBet scegli Predict Fixtures, genera le previsioni ed esporta i CSV.
          Puoi importare insieme Result (1/X/2) e U/O-2.5.
          Non serve una quota Bet365.
        </p>
        <label className="block max-w-xs text-sm text-zinc-300">
          Data delle partite contenute nei file
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="mt-1 w-full rounded-md border border-white/10 bg-zinc-900 p-2 text-zinc-100"
          />
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <label className="btn-primary cursor-pointer">
            {busy ? "Importazione..." : "Seleziona CSV"}
            <input
              type="file"
              accept=".csv,text/csv"
              multiple
              disabled={busy}
              className="sr-only"
              onChange={(e) => {
                void importFiles(e.currentTarget.files);
                e.currentTarget.value = "";
              }}
            />
          </label>
          <button type="button" className="text-sm text-zinc-400 hover:text-white" onClick={() => { setImports([]); setError(null); }}>
            Svuota anteprima
          </button>
        </div>
        {error && <p role="alert" className="text-sm text-rose-400">{error}</p>}
        <p className="text-xs text-zinc-500">
          Solo anteprima locale nel browser: nessun CSV viene inviato al server o salvato su Supabase.
          Aggiornando la pagina, i dati importati vengono persi.
        </p>
        {imports.length > 0 && (
          <p className="text-sm text-zinc-300">
            {imports.length} file · {predictions.length} previsioni valide · {warnings.length} righe scartate
          </p>
        )}
        {warnings.length > 0 && (
          <details className="text-sm text-amber-300">
            <summary className="cursor-pointer">Righe escluse ({warnings.length})</summary>
            <div className="mt-2 max-h-48 overflow-auto text-xs text-amber-200/80">
              {warnings.slice(0, 50).map((w, i) => (
                <p key={i}>{w.sourceFile}, riga {w.line}: {w.reason}</p>
              ))}
            </div>
          </details>
        )}
      </div>

      {predictions.length > 0 && (
        <>
          <div className="card space-y-4 p-5">
            <div>
              <h2 className="text-lg font-semibold text-zinc-100">Doppia sperimentale</h2>
              <p className="mt-1 text-xs text-zinc-500">
                Due partite diverse, probabilita&apos; singola minima 65%.
                Fascia teorica 1,70–2,00. Non utilizza quote bookmaker.
              </p>
            </div>
            {suggestion ? (
              <>
                <div className="grid gap-3 md:grid-cols-2">
                  {suggestion.picks.map((pick) => (
                    <div key={pick.fixtureKey} className="rounded-lg border border-indigo-400/20 bg-indigo-500/5 p-4">
                      <p className="text-xs text-zinc-500">{pick.fixtureDate}</p>
                      <p className="mt-1 font-medium text-zinc-100">{pick.homeTeam} – {pick.awayTeam}</p>
                      <p className="mt-2 text-indigo-300">{MARKET_LABELS[pick.market] ?? pick.market}</p>
                      <p className="text-xs text-zinc-400">
                        Probabilita&apos; modello {(pick.probability * 100).toFixed(1)}% ·
                        Quota equa {pick.fairOdds.toFixed(2)}
                      </p>
                    </div>
                  ))}
                </div>
                <p className="text-sm text-zinc-300">
                  Probabilita&apos; combinata stimata: <strong>{(suggestion.combinedProbability * 100).toFixed(1)}%</strong> ·
                  Quota equa combinata: <strong>{suggestion.combinedFairOdds.toFixed(2)}</strong>
                </p>
              </>
            ) : (
              <p className="text-sm text-zinc-400">
                Nessuna doppia soddisfa i criteri. Non viene forzata una schedina.
              </p>
            )}
            <p className="text-xs text-amber-300">
              ATTENZIONE: quota equa = 1/probabilita&apos; del modello, NON quota giocabile.
              La probabilita&apos; combinata assume indipendenza tra eventi e non prova
              che ci sia un vantaggio economico. Nessun suggerimento viene registrato
              come &quot;giocabile&quot; nel CRM.
            </p>
          </div>

          <div className="card p-5">
            <h2 className="mb-3 text-lg font-semibold text-zinc-100">Mercati stimati</h2>
            <div className="space-y-2">
              {picks.slice(0, 120).map((pick) => (
                <div
                  key={pick.fixtureKey + ":" + pick.market}
                  className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.05] py-2 text-sm"
                >
                  <div>
                    <p className="text-zinc-200">{pick.homeTeam} – {pick.awayTeam}</p>
                    <p className="text-xs text-zinc-500">{pick.fixtureDate} · {MARKET_LABELS[pick.market] ?? pick.market}</p>
                  </div>
                  <div className="text-right tabular-nums">
                    <p className="text-zinc-100">{(pick.probability * 100).toFixed(1)}%</p>
                    <p className="text-xs text-zinc-500">Equa {pick.fairOdds.toFixed(2)}</p>
                  </div>
                </div>
              ))}
            </div>
            {picks.length > 120 && <p className="mt-3 text-xs text-zinc-500">Prime 120 di {picks.length} selezioni.</p>}
          </div>
        </>
      )}
    </div>
  );
}
