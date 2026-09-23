// ============================================================
// Layer di accesso dati.
// In modalità DEMO restituisce i dati fittizi; altrimenti interroga
// Supabase (con mapping snake_case -> camelCase).
// ============================================================

import { createClient } from "@/lib/supabase/server";
import { isDemoMode } from "@/lib/config";
import { todayIsoDate } from "@/lib/dates";
import {
  isSupportedForAnalysis,
  selectCandidates,
  supportedLeagueIds,
} from "@/lib/analysis";
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
  AnalysisRun,
  AnalysisState,
  BankrollTransaction,
  Bet,
  BetRecord,
  Budget,
  CandidateMatch,
  Match,
  ModelVersion,
  SyncRun,
} from "@/types";

// ------------------------------------------------------------
// Mapping DB (snake_case) -> dominio (camelCase)
// ------------------------------------------------------------
/* eslint-disable @typescript-eslint/no-explicit-any */
function mapMatch(row: any): Match {
  return {
    id: row.id,
    externalId: row.external_id != null ? String(row.external_id) : null,
    competition: row.competition,
    homeTeam: row.home_team,
    awayTeam: row.away_team,
    kickoffAt: row.kickoff_at,
    state: row.status,
    leagueId: row.league_id != null ? Number(row.league_id) : null,
    season: row.season != null ? Number(row.season) : null,
    homeTeamId: row.home_team_id != null ? Number(row.home_team_id) : null,
    awayTeamId: row.away_team_id != null ? Number(row.away_team_id) : null,
    homeScore: row.home_score != null ? Number(row.home_score) : null,
    awayScore: row.away_score != null ? Number(row.away_score) : null,
  };
}

function mapAnalysis(row: any): Analysis {
  return {
    id: row.id,
    matchId: row.match_id,
    market: row.market,
    selection: row.selection,
    analysisOdds: Number(row.analysis_odds),
    bet365Odds: row.bet365_odds != null ? Number(row.bet365_odds) : null,
    estimatedProbability: Number(row.estimated_probability),
    fairOdds: Number(row.fair_odds),
    ev: row.ev != null ? Number(row.ev) : null,
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

function mapSyncRun(row: any): SyncRun {
  return {
    id: row.id,
    source: row.source,
    syncDate: row.sync_date,
    requestsUsed: Number(row.requests_used ?? 0),
    requestsLimit: row.requests_limit != null ? Number(row.requests_limit) : null,
    requestsRemaining:
      row.requests_remaining != null ? Number(row.requests_remaining) : null,
    fixturesFound: Number(row.fixtures_found ?? 0),
    fixturesImported: Number(row.fixtures_imported ?? 0),
    fixturesInserted: Number(row.fixtures_inserted ?? 0),
    status: row.status,
    errorMessage: row.error_message ?? null,
    createdAt: row.created_at,
  };
}

function mapAnalysisRun(row: any): AnalysisRun {
  return {
    id: row.id,
    candidatesFound: Number(row.candidates_found ?? 0),
    analyzed: Number(row.analyzed ?? 0),
    analysesCreated: Number(row.analyses_created ?? 0),
    requestsUsed: Number(row.requests_used ?? 0),
    deepseekCalls: Number(row.deepseek_calls ?? 0),
    status: row.status,
    errorMessage: row.error_message ?? null,
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

// ------------------------------------------------------------
// Partite importate da fonti esterne (API-Football)
// ------------------------------------------------------------

/**
 * Partite importate (con `external_id`) che non hanno ancora un'analisi.
 * Sono quelle che l'import ha appena salvato e che attendono di essere
 * analizzate.
 */
export async function getFixturesWithoutAnalysis(limit = 60): Promise<Match[]> {
  if (isDemoMode()) return [];

  const supabase = await createClient();
  const [{ data: matches }, { data: analyses }] = await Promise.all([
    supabase
      .from("matches")
      .select("*")
      .not("external_id", "is", null)
      // DESC: le partite appena importate (le più recenti) vengono per prime.
      // Il taglio a `limit` va fatto DOPO aver escluso quelle già analizzate,
      // altrimenti le partite vecchie riempirebbero la finestra.
      .order("kickoff_at", { ascending: false })
      .limit(300),
    supabase.from("analyses").select("match_id"),
  ]);

  const analyzed = new Set((analyses ?? []).map((a) => a.match_id));
  return (matches ?? [])
    .filter((m) => !analyzed.has(m.id))
    .slice(0, limit)
    .map(mapMatch);
}

/** Ultima sincronizzazione registrata (null se mai eseguita). */
export async function getLastSyncRun(): Promise<SyncRun | null> {
  if (isDemoMode()) return null;

  const supabase = await createClient();
  const { data } = await supabase
    .from("api_sync_runs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return data ? mapSyncRun(data) : null;
}

/**
 * Partite candidate all'analisi: importate, senza analisi, in programma o in
 * corso, appartenenti a una competizione SUPPORTATA, ordinate per calcio
 * d'inizio e limitate dal pre-filtro.
 *
 * Il tetto `max` (MAX_ANALYSIS_PER_RUN) è applicato DOPO il filtro per
 * competizione: le partite delle competizioni non ancora supportate restano
 * in attesa e non occupano i posti disponibili.
 * (Nessuna chiamata API: è il pre-filtro locale.)
 */
export async function getAnalysisCandidates(max?: number): Promise<Match[]> {
  if (isDemoMode()) return [];

  const supabase = await createClient();
  const [{ data: matches }, { data: analyses }] = await Promise.all([
    supabase
      .from("matches")
      .select("*")
      .not("external_id", "is", null)
      // Solo partite non ancora terminate: evita di caricare lo storico
      // (che altrimenti riempirebbe la finestra del limit).
      .in("status", ["scheduled", "live"])
      // Filtro in query: evita che partite non supportate consumino la
      // finestra del limit prima del filtro applicativo.
      .in("league_id", supportedLeagueIds())
      .order("kickoff_at", { ascending: true })
      .limit(300),
    supabase.from("analyses").select("match_id"),
  ]);

  const analyzed = new Set((analyses ?? []).map((a) => a.match_id));
  const unanalyzed = (matches ?? [])
    .filter((m) => !analyzed.has(m.id))
    .map(mapMatch);

  // Filtro autorevole (copre anche la stagione), poi ordina e taglia a `max`.
  return selectCandidates(unanalyzed.filter(isSupportedForAnalysis), max);
}

/** Ultima operazione di analisi registrata (null se mai eseguita). */
export async function getLastAnalysisRun(): Promise<AnalysisRun | null> {
  if (isDemoMode()) return null;

  const supabase = await createClient();
  const { data } = await supabase
    .from("analysis_runs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return data ? mapAnalysisRun(data) : null;
}

/** Chiamate API-Football consumate oggi (sync + analisi). */
export async function getTodayApiUsage(): Promise<{
  requests: number;
  runs: number;
}> {
  if (isDemoMode()) return { requests: 0, runs: 0 };

  const supabase = await createClient();
  const today = todayIsoDate();

  // Entrambe le tabelle hanno sync_date: confronto esatto, senza fusi.
  const [{ data: syncRows }, { data: analysisRows }] = await Promise.all([
    supabase.from("api_sync_runs").select("requests_used").eq("sync_date", today),
    supabase.from("analysis_runs").select("requests_used").eq("sync_date", today),
  ]);

  const sum = (rows: { requests_used?: number }[] | null) =>
    (rows ?? []).reduce((s, r) => s + Number(r.requests_used ?? 0), 0);

  return {
    requests: sum(syncRows) + sum(analysisRows),
    runs: (syncRows?.length ?? 0) + (analysisRows?.length ?? 0),
  };
}
