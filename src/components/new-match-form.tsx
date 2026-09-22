"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { createMatchWithAnalysis } from "@/app/(dashboard)/actions";
import {
  Field,
  FormError,
  FormNotice,
  FormSuccess,
} from "@/components/ui/field";
import { formatEv, formatOdds } from "@/lib/format";
import type { AnalysisState } from "@/types";

const MARKETS = [
  "1X2",
  "Doppia chance",
  "Over/Under 1.5",
  "Over/Under 2.5",
  "Over/Under 3.5",
  "GG/NG",
  "Handicap",
  "Altro",
];

const toNumber = (value: string): number => {
  const n = parseFloat(value.replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

export function NewMatchForm({ isDemo }: { isDemo: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Partita
  const [competition, setCompetition] = useState("");
  const [homeTeam, setHomeTeam] = useState("");
  const [awayTeam, setAwayTeam] = useState("");
  const [kickoff, setKickoff] = useState("");

  // Analisi
  const [market, setMarket] = useState("1X2");
  const [selection, setSelection] = useState("");
  const [analysisOdds, setAnalysisOdds] = useState("");
  const [bet365Odds, setBet365Odds] = useState("");
  const [probabilityPct, setProbabilityPct] = useState("");
  const [confidence, setConfidence] = useState("60");
  const [state, setState] = useState<AnalysisState>("da_valutare");
  const [risks, setRisks] = useState("");

  // Valori derivati mostrati in anteprima
  const probability = toNumber(probabilityPct) / 100;
  const bookOdds = toNumber(bet365Odds);
  const fairOdds = probability > 0 ? 1 / probability : 0;
  const ev = probability > 0 && bookOdds > 0 ? probability * bookOdds - 1 : 0;
  const hasPreview = probability > 0 && bookOdds > 0;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (isDemo) {
      setSuccess(
        "DEMO: i dati non vengono salvati. Collega Supabase per registrare partite reali."
      );
      return;
    }

    if (!kickoff) {
      setError("Inserisci data e ora del calcio d'inizio.");
      return;
    }

    setPending(true);
    try {
      const res = await createMatchWithAnalysis(
        {
          competition,
          homeTeam,
          awayTeam,
          kickoffAt: new Date(kickoff).toISOString(),
        },
        {
          market,
          selection,
          analysisOdds: toNumber(analysisOdds),
          bet365Odds: bookOdds,
          estimatedProbability: clamp(probability, 0, 1),
          confidence: Math.round(clamp(toNumber(confidence), 0, 100)),
          risks,
          state,
        }
      );

      if (res?.error) {
        setError(res.error);
        return;
      }

      setSuccess("Partita salvata.");
      router.push(res.matchId ? `/matches/${res.matchId}` : "/dashboard");
      router.refresh();
    } catch {
      setError("Errore imprevisto. Riprova.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {isDemo && (
        <FormNotice>
          Modalità DEMO: il form è compilabile ma i dati non verranno salvati.
          Collega Supabase per registrare partite reali.
        </FormNotice>
      )}

      <div className="card p-5">
        <h2 className="text-sm font-semibold tracking-tight text-zinc-100">
          Partita
        </h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Campionato / competizione">
            <input
              className="input w-full"
              value={competition}
              onChange={(e) => setCompetition(e.target.value)}
              placeholder="es. Serie A"
              required
            />
          </Field>
          <Field label="Calcio d'inizio">
            <input
              type="datetime-local"
              className="input w-full"
              value={kickoff}
              onChange={(e) => setKickoff(e.target.value)}
              required
            />
          </Field>
          <Field label="Squadra in casa">
            <input
              className="input w-full"
              value={homeTeam}
              onChange={(e) => setHomeTeam(e.target.value)}
              placeholder="es. Inter"
              required
            />
          </Field>
          <Field label="Squadra ospite">
            <input
              className="input w-full"
              value={awayTeam}
              onChange={(e) => setAwayTeam(e.target.value)}
              placeholder="es. Milan"
              required
            />
          </Field>
        </div>
      </div>

      <div className="card p-5">
        <h2 className="text-sm font-semibold tracking-tight text-zinc-100">
          Analisi
        </h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Mercato consigliato">
            <input
              className="input w-full"
              value={market}
              onChange={(e) => setMarket(e.target.value)}
              list="markets"
              placeholder="es. Over/Under 2.5"
              required
            />
            <datalist id="markets">
              {MARKETS.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          </Field>
          <Field label="Selezione">
            <input
              className="input w-full"
              value={selection}
              onChange={(e) => setSelection(e.target.value)}
              placeholder="es. Over 2.5"
              required
            />
          </Field>

          <Field label="Quota di analisi">
            <input
              type="number"
              step="0.01"
              min="1"
              className="input w-full"
              value={analysisOdds}
              onChange={(e) => setAnalysisOdds(e.target.value)}
              placeholder="es. 1.85"
            />
          </Field>
          <Field label="Quota bookmaker (Bet365)">
            <input
              type="number"
              step="0.01"
              min="1"
              className="input w-full"
              value={bet365Odds}
              onChange={(e) => setBet365Odds(e.target.value)}
              placeholder="es. 2.05"
              required
            />
          </Field>

          <Field
            label="Probabilità stimata (%)"
            hint="Probabilità che il modello assegna alla selezione."
          >
            <input
              type="number"
              step="0.1"
              min="0"
              max="100"
              className="input w-full"
              value={probabilityPct}
              onChange={(e) => setProbabilityPct(e.target.value)}
              placeholder="es. 52"
              required
            />
          </Field>
          <Field label="Affidabilità (%)">
            <input
              type="number"
              step="1"
              min="0"
              max="100"
              className="input w-full"
              value={confidence}
              onChange={(e) => setConfidence(e.target.value)}
            />
          </Field>

          <Field label="Stato">
            <select
              className="input w-full"
              value={state}
              onChange={(e) => setState(e.target.value as AnalysisState)}
            >
              <option value="da_valutare">Da valutare</option>
              <option value="giocabile">Giocabile</option>
              <option value="scartata">Scartata</option>
            </select>
          </Field>

          <div className="sm:col-span-2">
            <Field label="Rischi / motivazioni">
              <textarea
                className="input w-full"
                rows={3}
                value={risks}
                onChange={(e) => setRisks(e.target.value)}
                placeholder="Note sull'analisi, fattori di rischio, motivazioni…"
              />
            </Field>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 rounded-xl bg-white/[0.03] p-4 sm:max-w-md">
          <div>
            <p className="label">Quota equa calcolata</p>
            <p className="mt-1 text-lg font-semibold tabular-nums text-zinc-100">
              {hasPreview ? formatOdds(fairOdds) : "—"}
            </p>
          </div>
          <div>
            <p className="label">EV calcolato</p>
            <p
              className={`mt-1 text-lg font-semibold tabular-nums ${
                hasPreview
                  ? ev >= 0
                    ? "text-emerald-400"
                    : "text-rose-400"
                  : "text-zinc-100"
              }`}
            >
              {hasPreview ? formatEv(ev) : "—"}
            </p>
          </div>
        </div>
      </div>

      {error && <FormError>{error}</FormError>}
      {success && <FormSuccess>{success}</FormSuccess>}

      <div className="flex items-center justify-end gap-3">
        <button
          type="button"
          onClick={() => router.push("/dashboard")}
          className="btn-ghost"
        >
          Annulla
        </button>
        <button type="submit" disabled={pending} className="btn-primary">
          {pending ? "Salvataggio…" : "Salva partita"}
        </button>
      </div>
    </form>
  );
}
