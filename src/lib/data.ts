// ============================================================
// Layer di accesso dati.
// In modalità DEMO restituisce i dati fittizi; altrimenti interroga
// Supabase (con mapping snake_case -> camelCase).
// ============================================================

import { createClient } from "@/lib/supabase/server";
import { isDemoMode } from "@/lib/config";
import {
  demoAnalyses,
  demoBankrollTransactions,
  demoBets,
  demoBudgets,
  demoMatches,
  demoModelVersions,
} from "@/lib/demo-data";
import type {
  Analysis,
  AnalysisState,
  BankrollTransaction,
  Bet,
  BetRecord,
  Budget,
  CandidateMatch,
  Match,
  ModelVersion,
} from "@/types";

// ------------------------------------------------------------
// Mapping DB (snake_case) -> dominio (camelCase)
// ------------------------------------------------------------
/* eslint-disable @typescript-eslint/no-explicit-any */
function mapMatch(row: any): Match {
  return {
    id: row.id,
    competition: row.competition,
    homeTeam: row.home_team,
    awayTeam: row.away_team,
    kickoffAt: row.kickoff_at,
    state: row.status,
  };
}

function mapAnalysis(row: any): Analysis {
  return {
    id: row.id,
    matchId: row.match_id,
    market: row.market,
    selection: row.selection,
    analysisOdds: Number(row.analysis_odds),
    bet365Odds: Number(row.bet365_odds),
    estimatedProbability: Number(row.estimated_probability),
    fairOdds: Number(row.fair_odds),
    ev: Number(row.ev),
    confidence: Number(row.confidence),
    risks: row.risks ?? "",
    state: row.state,
    updatedAt: row.updated_at,
  };
}

function mapBet(row: any): Bet {
  return {
    id: row.id,
    matchId: row.match_id,
    analysisId: row.analysis_id,
    market: row.market,
    selection: row.selection,
    odds: Number(row.odds),
    closingOdds: row.closing_odds != null ? Number(row.closing_odds) : null,
    ev: Number(row.ev),
    stake: Number(row.stake),
    status: row.status,
    profit: Number(row.profit),
    settledAt: row.settled_at,
    createdAt: row.created_at,
  };
}

function mapBudget(row: any): Budget {
  return {
    id: row.id,
    periodType: row.period_type,
    period: row.period,
    amount: Number(row.amount),
  };
}

function mapBankrollTransaction(row: any): BankrollTransaction {
  return {
    id: row.id,
    type: row.type,
    amount: Number(row.amount),
    note: row.note ?? undefined,
    createdAt: row.created_at,
  };
}

function mapModelVersion(row: any): ModelVersion {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    parameters: row.parameters ?? undefined,
    active: row.active,
    createdAt: row.created_at,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// ------------------------------------------------------------
// Query
// ------------------------------------------------------------

/** Partite candidate per la dashboard "Oggi" (stato diverso da giocata/chiusa). */
export async function getCandidateMatches(): Promise<CandidateMatch[]> {
  if (isDemoMode()) {
    const candidates = new Set<AnalysisState>(["da_valutare", "giocabile", "scartata"]);
    return demoMatches
      .map((m) => {
        const a = demoAnalyses.find((x) => x.matchId === m.id);
        return a && candidates.has(a.state) ? { match: m, analysis: a } : null;
      })
      .filter((x): x is CandidateMatch => x !== null)
      .sort((a, b) => a.match.kickoffAt.localeCompare(b.match.kickoffAt));
  }

  const supabase = await createClient();
  const [{ data: matches }, { data: analyses }] = await Promise.all([
    supabase.from("matches").select("*").order("kickoff_at", { ascending: true }),
    supabase.from("analyses").select("*"),
  ]);

  const analysisByMatch = new Map<string, Analysis>(
    (analyses ?? []).map((a) => [a.match_id, mapAnalysis(a)])
  );
  const candidates = new Set<AnalysisState>(["da_valutare", "giocabile", "scartata"]);

  return (matches ?? [])
    .map((m) => {
      const a = analysisByMatch.get(m.id);
      return a && candidates.has(a.state)
        ? { match: mapMatch(m), analysis: a }
        : null;
    })
    .filter((x): x is CandidateMatch => x !== null);
}

/** Dettaglio di una partita + analisi. */
export async function getMatchDetail(matchId: string): Promise<CandidateMatch | null> {
  if (isDemoMode()) {
    const m = demoMatches.find((x) => x.id === matchId);
    const a = demoAnalyses.find((x) => x.matchId === matchId);
    return m && a ? { match: m, analysis: a } : null;
  }

  const supabase = await createClient();
  const [{ data: m }, { data: a }] = await Promise.all([
    supabase.from("matches").select("*").eq("id", matchId).maybeSingle(),
    supabase.from("analyses").select("*").eq("match_id", matchId).maybeSingle(),
  ]);

  if (!m) return null;
  return { match: mapMatch(m), analysis: a ? mapAnalysis(a) : nullAnalysis(matchId) };
}

function nullAnalysis(matchId: string): Analysis {
  return {
    id: "",
    matchId,
    market: "",
    selection: "",
    analysisOdds: 0,
    bet365Odds: 0,
    estimatedProbability: 0,
    fairOdds: 0,
    ev: 0,
    confidence: 0,
    risks: "",
    state: "da_valutare",
  };
}

/** Tutte le giocate (con match associato), dalla più recente. */
export async function getBets(): Promise<BetRecord[]> {
  if (isDemoMode()) {
    const matchById = new Map(demoMatches.map((m) => [m.id, m]));
    return [...demoBets]
      .sort((a, b) => (b.settledAt ?? b.createdAt).localeCompare(a.settledAt ?? a.createdAt))
      .map((b) => ({ bet: b, match: matchById.get(b.matchId)! }))
      .filter((r) => r.match != null);
  }

  const supabase = await createClient();
  const [{ data: bets }, { data: matches }] = await Promise.all([
    supabase.from("bets").select("*").order("created_at", { ascending: false }),
    supabase.from("matches").select("*"),
  ]);

  const matchById = new Map<string, Match>((matches ?? []).map((m) => [m.id, mapMatch(m)]));
  return (bets ?? [])
    .map((b) => {
      const match = matchById.get(b.match_id);
      return match ? { bet: mapBet(b), match } : null;
    })
    .filter((x): x is BetRecord => x !== null);
}

/** Solo le giocate chiuse (per le statistiche). */
export async function getSettledBets(): Promise<BetRecord[]> {
  const all = await getBets();
  return all.filter((r) => r.bet.status !== "open");
}

export async function getBudgets(): Promise<Budget[]> {
  if (isDemoMode()) return demoBudgets;
  const supabase = await createClient();
  const { data } = await supabase.from("budgets").select("*").order("period");
  return (data ?? []).map(mapBudget);
}

export async function getBankrollTransactions(): Promise<BankrollTransaction[]> {
  if (isDemoMode()) return demoBankrollTransactions;
  const supabase = await createClient();
  const { data } = await supabase
    .from("bankroll_transactions")
    .select("*")
    .order("created_at", { ascending: false });
  return (data ?? []).map(mapBankrollTransaction);
}

export async function getModelVersions(): Promise<ModelVersion[]> {
  if (isDemoMode()) return demoModelVersions;
  const supabase = await createClient();
  const { data } = await supabase.from("model_versions").select("*").order("created_at");
  return (data ?? []).map(mapModelVersion);
}

/** Bankroll corrente = somma delle transazioni. */
export function computeBankroll(transactions: BankrollTransaction[]): number {
  return transactions.reduce((sum, t) => sum + t.amount, 0);
}
