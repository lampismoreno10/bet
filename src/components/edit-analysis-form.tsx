"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import {
  deleteMatch,
  updateAnalysis,
  updateMatch,
} from "@/app/(dashboard)/actions";
import {
  Field,
  FormError,
  FormNotice,
  FormSuccess,
} from "@/components/ui/field";
import { toDateTimeLocal } from "@/lib/dates";
import { formatEv, formatOdds } from "@/lib/format";
import type { Analysis, AnalysisState, Match } from "@/types";

const toNumber = (value: string): number => {
  const n = parseFloat(value.replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

export function EditAnalysisForm({
  match,
  analysis,
  isDemo,
}: {
  match: Match;
  analysis: Analysis;
  isDemo: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Partita
  const [competition, setCompetition] = useState(match.competition);
  const [homeTeam, setHomeTeam] = useState(match.homeTeam);
  const [awayTeam, setAwayTeam] = useState(match.awayTeam);
  const [kickoff, setKickoff] = useState("");

  // Analisi
  const [market, setMarket] = useState(analysis.market);
  const [selection, setSelection] = useState(analysis.selection);
  const [analysisOdds, setAnalysisOdds] = useState(String(analysis.analysisOdds || ""));
  const [bet365Odds, setBet365Odds] = useState(String(analysis.bet365Odds || ""));
  const [probabilityPct, setProbabilityPct] = useState(
    analysis.estimatedProbability
      ? String(Number((analysis.estimatedProbability * 100).toFixed(1)))
      : ""
  );
  const [confidence, setConfidence] = useState(String(analysis.confidence || 0));
  const [state, setState] = useState<AnalysisState>(analysis.state);
  const [risks, setRisks] = useState(analysis.risks);

  // La conversione ISO -> datetime-local dipende dal fuso del browser:
  // avviene dopo il mount per evitare disallineamenti con il server.
  useEffect(() => {
    setKickoff(toDateTimeLocal(match.kickoffAt));
  }, [match.kickoffAt]);

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
      setSuccess("DEMO: le modifiche non vengono salvate.");
      return;
    }

    setPending(true);
    try {
      const matchRes = await updateMatch(match.id, {
        competition,
        homeTeam,
        awayTeam,
        kickoffAt: kickoff ? new Date(kickoff).toISOString() : match.kickoffAt,
      });
      if (matchRes?.error) {
        setError(matchRes.error);
        return;
      }

      // Se non esiste ancora un'analisi salvata non c'è nulla da aggiornare.
      if (analysis.id) {
        const analysisRes = await updateAnalysis(analysis.id, {
          market,
          selection,
          analysisOdds: toNumber(analysisOdds),
          bet365Odds: bookOdds,
          estimatedProbability: clamp(probability, 0, 1),
          confidence: Math.round(clamp(toNumber(confidence), 0, 100)),
          risks,
          state,
        });
        if (analysisRes?.error) {
          setError(analysisRes.error);
          return;
        }
      }

      setSuccess("Modifiche salvate.");
      router.refresh();
    } catch {
      setError("Errore imprevisto. Riprova.");
    } finally {
      setPending(false);
    }
  }

  async function handleDelete() {
    if (!window.confirm("Eliminare questa partita e la sua analisi?")) return;

    if (isDemo) {
      setSuccess("DEMO: l'eliminazione non viene eseguita.");
      return;
    }

    setPending(true);
    try {
      const res = await deleteMatch(match.id);
      if (res?.error) {
        setError(res.error);
        return;
      }
      router.push("/dashboard");
      router.refresh();
    } catch {
      setError("Errore imprevisto. Riprova.");
    } finally {
      setPending(false);
    }
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="btn-ghost">
        Modifica analisi
      </button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="card space-y-4 p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold tracking-tight text-zinc-100">
          Modifica partita e analisi
        </h2>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-sm text-zinc-500 hover:text-zinc-300"
        >
          Chiudi
        </button>
      </div>

      {isDemo && (
        <FormNotice>Modalità DEMO: le modifiche non verranno salvate.</FormNotice>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Campionato / competizione">
          <input
            className="input w-full"
            value={competition}
            onChange={(e) => setCompetition(e.target.value)}
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
            required
          />
        </Field>
        <Field label="Squadra ospite">
          <input
            className="input w-full"
            value={awayTeam}
            onChange={(e) => setAwayTeam(e.target.value)}
            required
          />
        </Field>

        <Field label="Mercato consigliato">
          <input
            className="input w-full"
            value={market}
            onChange={(e) => setMarket(e.target.value)}
            required
          />
        </Field>
        <Field label="Selezione">
          <input
            className="input w-full"
            value={selection}
            onChange={(e) => setSelection(e.target.value)}
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
            required
          />
        </Field>

        <Field label="Probabilità stimata (%)">
          <input
            type="number"
            step="0.1"
            min="0"
            max="100"
            className="input w-full"
            value={probabilityPct}
            onChange={(e) => setProbabilityPct(e.target.value)}
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
            <option value="giocata">Giocata</option>
            <option value="chiusa">Chiusa</option>
          </select>
        </Field>

        <div className="sm:col-span-2">
          <Field label="Rischi / motivazioni">
            <textarea
              className="input w-full"
              rows={3}
              value={risks}
              onChange={(e) => setRisks(e.target.value)}
            />
          </Field>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 rounded-xl bg-white/[0.03] p-4 sm:max-w-md">
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

      {error && <FormError>{error}</FormError>}
      {success && <FormSuccess>{success}</FormSuccess>}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.05] pt-4">
        <button
          type="button"
          onClick={handleDelete}
          disabled={pending}
          className="rounded-lg border border-rose-500/20 px-3 py-1.5 text-sm font-medium text-rose-300 transition hover:bg-rose-500/10 disabled:opacity-60"
        >
          Elimina partita
        </button>
        <button type="submit" disabled={pending} className="btn-primary">
          {pending ? "Salvataggio…" : "Salva modifiche"}
        </button>
      </div>
    </form>
  );
}
