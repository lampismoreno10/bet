// ============================================================
// Motore decisionale delle analisi — PURO e SERVER-SIDE.
//
// La decisione finale (giocabile / scartata / da_valutare) NON dipende dal
// campo "state" del modello: la prende questo modulo DOPO la risposta di
// DeepSeek, applicando soglie esplicite per fonte dati e verificando che
// esista una quota REALE per un mercato supportato.
//
// Principi:
//   - è normale che una giornata produca 0 giocabili: non si forza mai una
//     giocata, non esiste una quota minima obbligatoria;
//   - dati mancanti (quota reale, contesto, mercato non validabile) =>
//     "da_valutare", mai "giocabile";
//   - dati presenti ma sotto soglia => "scartata".
//
// Il modulo non ha import a runtime: è testabile senza rete
// (vedi scripts/self-test.ts).
// ============================================================

import type { StatsSource } from "@/lib/ai/deepseek";
import type { AnalysisState } from "@/types";

/** Fonti statistiche con soglie dedicate. */
export type ThresholdSource = "openfootball" | "api-football-prediction";

export interface DecisionThresholds {
  /** EV minimo (forma decimale: 0.05 = +5%). */
  minEv: number;
  /** Affidabilità minima (0..100). */
  minConfidence: number;
}

/**
 * Soglie minime per fonte dati.
 *
 * Il fallback di API-Football è una stima esterna, non una statistica
 * indipendente verificata: per questo le sue soglie sono più severe.
 */
export const DECISION_THRESHOLDS: Record<ThresholdSource, DecisionThresholds> = {
  openfootball: { minEv: 0.05, minConfidence: 65 },
  "api-football-prediction": { minEv: 0.08, minConfidence: 70 },
};

export interface DecisionInput {
  statsSource: StatsSource;
  /** EV calcolato dal SERVER (mai dal modello). null = non calcolabile. */
  ev: number | null;
  confidence: number;
  /** Esiste una quota reale per il mercato scelto. */
  hasRealOdds: boolean;
  /** Il mercato scelto è supportato ed è stato validato sulle quote reali. */
  marketSupported: boolean;
}

export interface Decision {
  state: AnalysisState;
  /** Spiegazione della decisione, persistita insieme all'analisi. */
  notes: string[];
  /** Soglie effettivamente applicate (null quando i dati non bastano). */
  thresholds: DecisionThresholds | null;
}

function isThresholdSource(value: StatsSource): value is ThresholdSource {
  return value === "openfootball" || value === "api-football-prediction";
}

function pct(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

/**
 * Decide lo stato finale di un'analisi.
 *
 * Ordine di valutazione:
 *   1. dati mancanti o non validabili => "da_valutare";
 *   2. soglie della fonte soddisfatte => "giocabile";
 *   3. altrimenti => "scartata".
 */
export function decideAnalysis(input: DecisionInput): Decision {
  const blockers: string[] = [];

  if (!input.marketSupported) {
    blockers.push("mercato non supportato o non validabile");
  }
  if (!input.hasRealOdds) {
    blockers.push("quota bookmaker reale assente");
  }
  if (!isThresholdSource(input.statsSource)) {
    blockers.push("contesto statistico insufficiente");
  }
  if (input.ev == null || !Number.isFinite(input.ev)) {
    blockers.push("EV non calcolabile");
  }

  if (blockers.length > 0) {
    return {
      state: "da_valutare",
      notes: [`Regola server: da_valutare (${blockers.join("; ")}).`],
      thresholds: null,
    };
  }

  const source = input.statsSource as ThresholdSource;
  const thresholds = DECISION_THRESHOLDS[source];
  const ev = input.ev as number;

  const evOk = ev >= thresholds.minEv;
  const confidenceOk = input.confidence >= thresholds.minConfidence;

  if (evOk && confidenceOk) {
    return {
      state: "giocabile",
      notes: [
        `Regola server: giocabile — EV ${pct(ev)} >= ${pct(
          thresholds.minEv
        )} e affidabilità ${input.confidence} >= ${thresholds.minConfidence} (fonte ${source}).`,
      ],
      thresholds,
    };
  }

  const gaps: string[] = [];
  if (!evOk) gaps.push(`EV ${pct(ev)} < ${pct(thresholds.minEv)}`);
  if (!confidenceOk) {
    gaps.push(`affidabilità ${input.confidence} < ${thresholds.minConfidence}`);
  }

  return {
    state: "scartata",
    notes: [`Regola server: scartata — ${gaps.join(" e ")} (fonte ${source}).`],
    thresholds,
  };
}

// ------------------------------------------------------------
// Schedina — PREPARATA, non ancora costruita dalla pipeline.
//
// Regole richieste: al massimo 2 eventi, tutti già "giocabile" e validi
// singolarmente, quota combinata preferibilmente 1.70–2.20, mai inserire
// una selezione scartata solo per raggiungere la quota.
// ------------------------------------------------------------

export const SCHEDINA_MAX_EVENTS = 2;
export const SCHEDINA_TARGET_MIN_ODDS = 1.7;
export const SCHEDINA_TARGET_MAX_ODDS = 2.2;

export interface SchedinaCandidate {
  /** id dell'analisi (state = "giocabile"). */
  id: string;
  /** Quota reale della selezione. */
  odds: number;
  /** EV della selezione (forma decimale). */
  ev: number;
  confidence: number;
}

export interface Schedina {
  picks: SchedinaCandidate[];
  totalOdds: number;
  /** EV della combinazione, eventi indipendenti: (1+ev1)(1+ev2) − 1. */
  combinedEv: number;
  /** True se la quota combinata cade nell'intervallo 1.70–2.20. */
  inTargetRange: boolean;
}

function avgConfidence(schedina: Schedina): number {
  if (schedina.picks.length === 0) return 0;
  return (
    schedina.picks.reduce((sum, p) => sum + p.confidence, 0) / schedina.picks.length
  );
}

function toSchedina(picks: SchedinaCandidate[]): Schedina {
  const totalOdds = Number(picks.reduce((acc, p) => acc * p.odds, 1).toFixed(4));
  const combinedEv = Number(
    (picks.reduce((acc, p) => acc * (1 + p.ev), 1) - 1).toFixed(4)
  );
  return {
    picks,
    totalOdds,
    combinedEv,
    inTargetRange:
      totalOdds >= SCHEDINA_TARGET_MIN_ODDS && totalOdds <= SCHEDINA_TARGET_MAX_ODDS,
  };
}

/**
 * Sceglie AL MASSIMO 2 selezioni già validate (state "giocabile") con quota
 * combinata preferibilmente 1.70–2.20.
 *
 * - se esiste almeno una combinazione nell'intervallo, sceglie la migliore
 *   fra quelle (EV combinato più alto);
 * - altrimenti restituisce la migliore disponibile con `inTargetRange: false`
 *   (la decisione di giocarla resta al chiamante: non si forza nulla);
 * - restituisce null se non c'è nessuna selezione valida.
 *
 * Le selezioni scartate NON entrano mai: il chiamante deve passare solo
 * analisi con state "giocabile".
 */
export function buildSchedina(
  candidates: SchedinaCandidate[]
): Schedina | null {
  const valid = candidates.filter(
    (c) =>
      Number.isFinite(c.odds) &&
      c.odds > 1 &&
      Number.isFinite(c.ev) &&
      Number.isFinite(c.confidence)
  );
  if (valid.length === 0) return null;

  const combos: Schedina[] = [];
  for (let i = 0; i < valid.length; i += 1) {
    combos.push(toSchedina([valid[i]]));
    for (let j = i + 1; j < valid.length; j += 1) {
      combos.push(toSchedina([valid[i], valid[j]]));
    }
  }

  const inRange = combos.filter((c) => c.inTargetRange);
  const pool = inRange.length > 0 ? inRange : combos;

  pool.sort(
    (a, b) =>
      b.combinedEv - a.combinedEv ||
      avgConfidence(b) - avgConfidence(a) ||
      a.picks.length - b.picks.length
  );

  return pool[0];
}
