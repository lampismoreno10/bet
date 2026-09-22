// ============================================================
// Modello dati del dominio (camelCase, usato dall'interfaccia).
// Le colonne del database Supabase sono in snake_case: il mapping
// avviene in `src/lib/data.ts`.
// ============================================================

/** Stato della partita (evento sportivo). */
export type MatchState = "scheduled" | "live" | "finished";

/** Stato del flusso di lavoro di un'analisi. */
export type AnalysisState =
  | "da_valutare"
  | "giocabile"
  | "scartata"
  | "giocata"
  | "chiusa";

/** Stato di una giocata (bet). */
export type BetStatus = "open" | "won" | "lost" | "void";

export interface Match {
  id: string;
  competition: string; // campionato/competizione
  homeTeam: string;
  awayTeam: string;
  kickoffAt: string; // ISO 8601
  state: MatchState;
  isDemo?: boolean;
}

export interface Analysis {
  id: string;
  matchId: string;
  market: string; // mercato consigliato (es. "1X2", "Over/Under 2.5", "GG/NG")
  selection: string; // selezione consigliata (es. "1", "Over 2.5", "GG")
  analysisOdds: number; // quota di analisi
  bet365Odds: number; // quota Bet365 effettivamente giocata
  estimatedProbability: number; // 0..1
  fairOdds: number; // quota equa = 1 / probabilità stimata
  ev: number; // expected value in forma decimale (es. 0.05 = +5%)
  confidence: number; // affidabilità 0..100
  risks: string; // rischi / motivazioni
  state: AnalysisState;
  updatedAt?: string;
  isDemo?: boolean;
}

export interface Bet {
  id: string;
  matchId: string;
  analysisId: string;
  market: string;
  selection: string;
  odds: number; // quota giocata
  closingOdds: number | null; // quota di chiusura (per il CLV)
  ev: number; // EV denormalizzato dall'analisi (per il report)
  stake: number;
  status: BetStatus;
  profit: number; // 0 se open/void, positivo se won, negativo se lost
  settledAt: string | null;
  createdAt: string;
  isDemo?: boolean;
}

export interface Budget {
  id: string;
  periodType: "monthly" | "annual";
  period: string; // "2026-09" oppure "2026"
  amount: number;
  isDemo?: boolean;
}

export type BankrollTransactionType =
  | "deposit"
  | "withdrawal"
  | "bet"
  | "payout";

export interface BankrollTransaction {
  id: string;
  type: BankrollTransactionType;
  amount: number; // positivo = entrata, negativo = uscita
  note?: string;
  createdAt: string;
  isDemo?: boolean;
}

export interface ModelVersion {
  id: string;
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
  active: boolean;
  createdAt: string;
  isDemo?: boolean;
}

/** Match + analisi associata: unità base della dashboard. */
export interface CandidateMatch {
  match: Match;
  analysis: Analysis;
}

// ------------------------------------------------------------
// Input dei form (usati dai form lato client e dalle server action)
// ------------------------------------------------------------

export interface MatchInput {
  competition: string;
  homeTeam: string;
  awayTeam: string;
  kickoffAt: string; // ISO 8601
}

export interface AnalysisInput {
  market: string;
  selection: string;
  analysisOdds: number;
  bet365Odds: number;
  estimatedProbability: number; // 0..1
  confidence: number; // 0..100
  risks: string;
  state: AnalysisState;
}

/** Bet + match associato: unità base dell'archivio giocate. */
export interface BetRecord {
  bet: Bet;
  match: Match;
}

// ------------------------------------------------------------
// Importazione partite da API-Football
// ------------------------------------------------------------

export type SyncRunStatus = "ok" | "error" | "quota_exceeded";

/** Una sincronizzazione registrata (per controllare la quota API giornaliera). */
export interface SyncRun {
  id: string;
  source: string;
  syncDate: string;
  requestsUsed: number;
  requestsLimit: number | null;
  requestsRemaining: number | null;
  fixturesFound: number;
  fixturesImported: number;
  fixturesInserted: number;
  status: SyncRunStatus;
  errorMessage: string | null;
  createdAt: string;
}

/** Esito restituito dalla server action al pulsante "Aggiorna partite". */
export interface SyncOutcome {
  ok: boolean;
  status: SyncRunStatus;
  message: string;
  requestsUsed: number;
  requestsLimit: number | null;
  requestsRemaining: number | null;
  fixturesFound: number;
  /** Righe inviate all'upsert (nuove + aggiornate). */
  fixturesImported: number;
  /** Solo le partite realmente nuove. */
  fixturesInserted: number;
}
