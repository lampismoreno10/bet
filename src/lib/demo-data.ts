// ============================================================
// DATI DEMO — usati in modalità DEMO per mostrare l'interfaccia
// senza un progetto Supabase configurato.
//
// ⚠️ TUTTI i dati qui sotto sono FITTIZI e chiaramente etichettati
//    (competizioni prefissate "DEMO ·", squadre inventate).
//    Nessun dato reale di quote, squadre o risultati è incluso.
// ============================================================

import type {
  Analysis,
  AnalysisState,
  BankrollTransaction,
  Bet,
  BetStatus,
  Budget,
  Match,
  MatchState,
  ModelVersion,
} from "@/types";

const round = (n: number, d = 2) => Number(n.toFixed(d));

function match(
  id: string,
  competition: string,
  homeTeam: string,
  awayTeam: string,
  kickoffAt: string,
  state: MatchState
): Match {
  return { id, competition, homeTeam, awayTeam, kickoffAt, state, isDemo: true };
}

function analysis(
  id: string,
  matchId: string,
  market: string,
  selection: string,
  analysisOdds: number,
  bet365Odds: number,
  prob: number,
  ev: number,
  confidence: number,
  risks: string,
  state: AnalysisState
): Analysis {
  return {
    id,
    matchId,
    market,
    selection,
    analysisOdds,
    bet365Odds,
    estimatedProbability: prob,
    fairOdds: round(1 / prob),
    ev,
    confidence,
    risks,
    state,
    isDemo: true,
  };
}

function bet(
  id: string,
  matchId: string,
  analysisId: string,
  market: string,
  selection: string,
  odds: number,
  closingOdds: number | null,
  ev: number,
  stake: number,
  status: BetStatus,
  profit: number,
  settledAt: string | null,
  createdAt: string
): Bet {
  return {
    id,
    matchId,
    analysisId,
    market,
    selection,
    odds,
    closingOdds,
    ev,
    stake,
    status,
    profit,
    settledAt,
    createdAt,
    isDemo: true,
  };
}

// ------------------------------------------------------------
// PARTITE
// ------------------------------------------------------------
export const demoMatches: Match[] = [
  // — Candidate in valutazione (oggi / prossimi giorni) —
  match("m1", "DEMO · Campionato Nord", "FC Aurora", "US Fenice", "2026-09-21T18:30:00+02:00", "scheduled"),
  match("m2", "DEMO · Campionato Nord", "Atletico Boreale", "Calcio Riviera", "2026-09-21T20:45:00+02:00", "scheduled"),
  match("m3", "DEMO · Campionato Sud", "Sporting Valle", "Real Marina", "2026-09-21T15:00:00+02:00", "scheduled"),
  match("m4", "DEMO · Campionato Sud", "Torretta FC", "AC Lido", "2026-09-22T18:30:00+02:00", "scheduled"),
  match("m5", "DEMO · Campionato Nord", "Virtus Colle", "Dinamo Sabbia", "2026-09-21T21:00:00+02:00", "scheduled"),
  match("m6", "DEMO · Coppa Esempio", "FC Prato Blu", "Union Quercia", "2026-09-23T20:45:00+02:00", "scheduled"),

  // — Giocata (in corso, bet ancora aperta) —
  match("m10", "DEMO · Campionato Nord", "FC Prato Blu", "Real Marina", "2026-09-21T18:00:00+02:00", "live"),

  // — Storico (giocate chiuse) —
  match("m11", "DEMO · Campionato Nord", "Atletico Boreale", "Torretta FC", "2026-09-05T18:30:00+02:00", "finished"),
  match("m12", "DEMO · Campionato Nord", "US Fenice", "Sporting Valle", "2026-09-06T18:30:00+02:00", "finished"),
  match("m13", "DEMO · Campionato Sud", "Dinamo Sabbia", "FC Aurelia", "2026-09-07T18:30:00+02:00", "finished"),
  match("m14", "DEMO · Coppa Esempio", "Calcio Riviera", "US Nomade", "2026-09-08T20:45:00+02:00", "finished"),
  match("m15", "DEMO · Campionato Nord", "AC Lido", "Virtus Colle", "2026-09-09T18:30:00+02:00", "finished"),
  match("m16", "DEMO · Campionato Sud", "Union Quercia", "Atletico Boreale", "2026-09-11T18:30:00+02:00", "finished"),
  match("m17", "DEMO · Campionato Nord", "Real Marina", "FC Prato Blu", "2026-09-12T18:30:00+02:00", "finished"),
  match("m18", "DEMO · Coppa Esempio", "Torretta FC", "US Fenice", "2026-09-14T20:45:00+02:00", "finished"),
  match("m19", "DEMO · Campionato Sud", "FC Aurelia", "Calcio Riviera", "2026-09-16T18:30:00+02:00", "finished"),
  match("m20", "DEMO · Campionato Nord", "Sporting Valle", "Dinamo Sabbia", "2026-09-18T18:30:00+02:00", "finished"),
];

// ------------------------------------------------------------
// ANALISI
// ------------------------------------------------------------
export const demoAnalyses: Analysis[] = [
  // — Candidate —
  analysis("a1", "m1", "1X2", "1", 1.9, 2.05, 0.52, 0.066, 72, "Quota Bet365 superiore alla quota equa. Rischio: infortunio del terzino destro titolare.", "giocabile"),
  analysis("a2", "m2", "Over/Under 2.5", "Over 2.5", 1.8, 1.85, 0.55, 0.018, 48, "EV marginale. Mancano conferme sui portieri titolari: serve un controllo prima di giocare.", "da_valutare"),
  analysis("a3", "m3", "1X2", "2", 3.1, 2.9, 0.3, -0.13, 40, "EV negativo: la quota giocabile è sotto la quota equa. Nessun valore, partita scartata.", "scartata"),
  analysis("a4", "m4", "GG/NG", "NG", 1.95, 2.0, 0.51, 0.02, 52, "Quote in movimento nelle ultime ore. Monitorare la chiusura prima di decidere.", "da_valutare"),
  analysis("a5", "m5", "Over/Under 1.5", "Over 1.5", 1.45, 1.5, 0.7, 0.05, 80, "Quota bassa ma EV positivo e stabile. Alta affidabilità del modello su questo mercato.", "giocabile"),
  analysis("a6", "m6", "1X2", "X", 3.4, 3.5, 0.29, 0.015, 45, "Pari con valore marginale. Attendere la chiusura delle quote: rischio di ribasso.", "da_valutare"),

  // — Giocata (in corso) —
  analysis("a10", "m10", "1X2", "1", 1.9, 2.05, 0.52, 0.066, 72, "Giocata in corso: esito in attesa.", "giocata"),

  // — Storico (chiuse) —
  analysis("a11", "m11", "Over/Under 2.5", "Over 2.5", 1.82, 1.85, 0.57, 0.06, 68, "Giocata chiusa.", "chiusa"),
  analysis("a12", "m12", "1X2", "2", 2.08, 2.1, 0.5, 0.04, 55, "Giocata chiusa.", "chiusa"),
  analysis("a13", "m13", "GG/NG", "GG", 2.35, 2.4, 0.45, 0.09, 64, "Giocata chiusa.", "chiusa"),
  analysis("a14", "m14", "1X2", "1", 1.7, 1.72, 0.6, 0.03, 70, "Giocata chiusa.", "chiusa"),
  analysis("a15", "m15", "Over/Under 1.5", "Under 1.5", 2.03, 2.05, 0.49, 0.01, 50, "Giocata chiusa.", "chiusa"),
  analysis("a16", "m16", "1X2", "X2", 1.93, 1.95, 0.54, 0.05, 60, "Giocata chiusa.", "chiusa"),
  analysis("a17", "m17", "Over/Under 2.5", "Over 2.5", 2.62, 2.6, 0.38, -0.02, 42, "Giocata chiusa.", "chiusa"),
  analysis("a18", "m18", "GG/NG", "NG", 1.78, 1.8, 0.59, 0.07, 66, "Giocata chiusa.", "chiusa"),
  analysis("a19", "m19", "1X2", "1", 2.18, 2.2, 0.46, 0.02, 54, "Giocata chiusa.", "chiusa"),
  analysis("a20", "m20", "Over/Under 2.5", "Over 2.5", 2.1, 2.15, 0.5, 0.08, 74, "Giocata chiusa.", "chiusa"),
];

// ------------------------------------------------------------
// GIOCATE
// ------------------------------------------------------------
export const demoBets: Bet[] = [
  // Aperta
  bet("b0", "m10", "a10", "1X2", "1", 2.05, null, 0.066, 50, "open", 0, null, "2026-09-21T17:50:00+02:00"),

  // Chiuse
  bet("b1", "m11", "a11", "Over/Under 2.5", "Over 2.5", 1.85, 1.8, 0.06, 50, "won", 42.5, "2026-09-05T21:00:00+02:00", "2026-09-05T17:00:00+02:00"),
  bet("b2", "m12", "a12", "1X2", "2", 2.1, 2.15, 0.04, 50, "lost", -50, "2026-09-06T21:00:00+02:00", "2026-09-06T17:00:00+02:00"),
  bet("b3", "m13", "a13", "GG/NG", "GG", 2.4, 2.35, 0.09, 40, "won", 56, "2026-09-07T21:00:00+02:00", "2026-09-07T17:00:00+02:00"),
  bet("b4", "m14", "a14", "1X2", "1", 1.72, 1.68, 0.03, 60, "won", 43.2, "2026-09-08T21:00:00+02:00", "2026-09-08T17:00:00+02:00"),
  bet("b5", "m15", "a15", "Over/Under 1.5", "Under 1.5", 2.05, 2.1, 0.01, 50, "lost", -50, "2026-09-09T21:00:00+02:00", "2026-09-09T17:00:00+02:00"),
  bet("b6", "m16", "a16", "1X2", "X2", 1.95, 1.9, 0.05, 50, "won", 47.5, "2026-09-11T21:00:00+02:00", "2026-09-11T17:00:00+02:00"),
  bet("b7", "m17", "a17", "Over/Under 2.5", "Over 2.5", 2.6, 2.7, -0.02, 30, "lost", -30, "2026-09-12T21:00:00+02:00", "2026-09-12T17:00:00+02:00"),
  bet("b8", "m18", "a18", "GG/NG", "NG", 1.8, 1.75, 0.07, 60, "won", 48, "2026-09-14T21:00:00+02:00", "2026-09-14T17:00:00+02:00"),
  bet("b9", "m19", "a19", "1X2", "1", 2.2, 2.25, 0.02, 40, "lost", -40, "2026-09-16T21:00:00+02:00", "2026-09-16T17:00:00+02:00"),
  bet("b10", "m20", "a20", "Over/Under 2.5", "Over 2.5", 2.15, 2.05, 0.08, 50, "won", 57.5, "2026-09-18T21:00:00+02:00", "2026-09-18T17:00:00+02:00"),
];

// ------------------------------------------------------------
// BUDGET
// ------------------------------------------------------------
export const demoBudgets: Budget[] = [
  { id: "bud1", periodType: "monthly", period: "2026-09", amount: 2000, isDemo: true },
  { id: "bud2", periodType: "annual", period: "2026", amount: 24000, isDemo: true },
];

// ------------------------------------------------------------
// TRANSAZIONI BANKROLL
// ------------------------------------------------------------
export const demoBankrollTransactions: BankrollTransaction[] = [
  { id: "btx1", type: "deposit", amount: 5000, note: "Deposito iniziale", createdAt: "2026-09-01T10:00:00+02:00", isDemo: true },
  { id: "btx2", type: "withdrawal", amount: -500, note: "Prelievo parziale", createdAt: "2026-09-10T10:00:00+02:00", isDemo: true },
];

// ------------------------------------------------------------
// VERSIONI DEL MODELLO
// ------------------------------------------------------------
export const demoModelVersions: ModelVersion[] = [
  {
    id: "mv1",
    name: "Modello EV v1.0",
    description: "Modello value-betting basato su probabilità stimata e quota equa.",
    parameters: { minConfidence: 55, minEv: 0.03, maxOdds: 3.0 },
    active: true,
    createdAt: "2026-09-01T10:00:00+02:00",
    isDemo: true,
  },
];
