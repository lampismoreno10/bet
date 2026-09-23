"use server";

// ============================================================
// Operazioni operative (solo server, solo admin):
//   - analyzeMatches   -> contesto + quote reali + DeepSeek + validazione
//   - runFullPipeline  -> sync + analisi in sequenza
//   - updateResults    -> risultati + SETTLEMENT AUTOMATICO
//
// API-Football non è più usata per l'arricchimento pesante. Resta per:
//   - sync delle partite e aggiornamento risultati
//   - quote REALI (/odds, 1 richiesta per partita)
//   - fallback leggero (/predictions, 1 richiesta per partita, SOLO per le
//     competizioni senza dataset OpenFootball)
// Tutte le chiamate passano dal throttle centralizzato.
// ============================================================

import { revalidatePath } from "next/cache";

import { syncFixtures } from "@/app/(dashboard)/sync-actions";
import { resolveAdminContext } from "@/lib/auth/admin-context";
import { getAnalysisCandidates } from "@/lib/data";
import { todayIsoDate } from "@/lib/dates";
import {
  computeEv,
  computeFairOdds,
  getMarket,
  parseModelSelection,
  settleMarket,
  type MarketCode,
} from "@/lib/sports/markets";
import { decideAnalysis } from "@/lib/sports/decision";
import { createClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  analyzeMatchWithDeepSeek,
  isDeepSeekConfigured,
  type DeepSeekAnalysis,
  type MatchContext,
  type StatsSource,
} from "@/lib/ai/deepseek";
import {
  fetchFixtureOdds,
  fetchFixturesByDate,
  fetchPrediction,
  isSportsApiConfigured,
  type FixtureOdds,
  type FixturePrediction,
} from "@/lib/sports/api-football";
import {
  loadLeague,
  OPENFOOTBALL_DATASETS,
  resolveOpenFootballTeam,
  type OpenFootballLeague,
  type OpenFootballMatchResult,
  type OpenFootballTeamStats,
  type StandingRow,
  type TeamStatistics,
} from "@/lib/sports/openfootball";
import { sportsThrottle } from "@/lib/sports/throttle";
import type {
  AnalysisOutcome,
  AnalysisState,
  Match,
  MatchState,
  ResultsOutcome,
} from "@/types";

const FINISHED_STATUSES = new Set(["FT", "AET", "PEN", "AWD", "WO"]);

function mapFixtureStatus(short: string): MatchState {
  if (FINISHED_STATUSES.has(short)) return "finished";
  if (["1H", "HT", "2H", "ET", "BT", "P", "SUSP", "INT", "LIVE"].includes(short)) {
    return "live";
  }
  return "scheduled";
}

// ------------------------------------------------------------
// Costruzione del contesto
// ------------------------------------------------------------

/** Contesto vuoto: nessun dato di arricchimento, nessuna invenzione. */
function emptyContext(match: Match): MatchContext {
  return {
    homeTeam: match.homeTeam,
    awayTeam: match.awayTeam,
    competition: match.competition,
    kickoffAt: match.kickoffAt,
    statsSource: null,
    homeStats: null,
    awayStats: null,
    standings: null,
    prediction: null,
    odds: null,
  };
}

const RESULT_LABEL = { W: "V", D: "N", L: "P" } as const;

/** Una riga leggibile per il prompt, es. "V 2-1 vs Como 1907 (casa)". */
function formatLast5Entry(entry: OpenFootballMatchResult): string {
  const venue = entry.home ? "casa" : "trasferta";
  return `${RESULT_LABEL[entry.result]} ${entry.goalsFor}-${entry.goalsAgainst} vs ${entry.opponent} (${venue})`;
}

/** Adatta le statistiche OpenFootball al vocabolario del contesto. */
function toTeamStatistics(stats: OpenFootballTeamStats): TeamStatistics {
  return {
    form: stats.seasonForm || null,
    goalsFor: stats.goalsFor,
    goalsAgainst: stats.goalsAgainst,
    wins: stats.wins,
    draws: stats.draws,
    losses: stats.losses,
    played: stats.played,
    points: stats.points,
    rank: stats.rank,
    goalDifference: stats.goalDifference,
    avgGoalsFor: stats.avgGoalsFor,
    avgGoalsAgainst: stats.avgGoalsAgainst,
    homeForm: stats.homeForm || null,
    awayForm: stats.awayForm || null,
    over15: stats.over15,
    over25: stats.over25,
    under45: stats.under45,
    btts: stats.btts,
    last5: stats.last5.map(formatLast5Entry),
  };
}

/**
 * Classifica: le due squadre in campo vengono rinominate con il nome
 * salvato in `matches`, così la riga corrisponde a homeTeam/awayTeam.
 */
function toStandingRows(
  league: OpenFootballLeague,
  homeKey: string,
  awayKey: string,
  match: Match
): StandingRow[] {
  return league.standings.map((team) => ({
    rank: team.rank,
    team:
      team.team === homeKey
        ? match.homeTeam
        : team.team === awayKey
          ? match.awayTeam
          : team.team,
    points: team.points,
    played: team.played,
    goalDifference: team.goalDifference,
  }));
}

/**
 * Contesto da OpenFootball. Restituisce null se una delle due squadre non è
 * riconosciuta: in quel caso si passa al fallback.
 */
function buildOpenFootballContext(
  match: Match,
  league: OpenFootballLeague
): MatchContext | null {
  const homeKey = resolveOpenFootballTeam(match.homeTeam, league);
  const awayKey = resolveOpenFootballTeam(match.awayTeam, league);
  if (!homeKey || !awayKey) return null;

  const home = league.teams.get(homeKey);
  const away = league.teams.get(awayKey);
  if (!home || !away) return null;

  return {
    ...emptyContext(match),
    statsSource: "openfootball",
    homeStats: toTeamStatistics(home),
    awayStats: toTeamStatistics(away),
    standings: toStandingRows(league, homeKey, awayKey, match),
  };
}

/** Contesto di fallback: solo la stima di terze parti, chiaramente etichettata. */
function buildFallbackContext(
  match: Match,
  prediction: FixturePrediction | null
): MatchContext {
  return {
    ...emptyContext(match),
    statsSource: prediction ? "api-football-prediction" : null,
    prediction,
  };
}

/**
 * True se il contesto basta per interrogare DeepSeek: statistiche piene
 * OpenFootball, oppure almeno la stima di fallback.
 */
function hasEnoughContext(ctx: MatchContext): boolean {
  if (ctx.homeStats && ctx.awayStats) return true;
  return ctx.prediction != null;
}

// ------------------------------------------------------------
// Validazione della scelta del modello contro le quote REALI
// ------------------------------------------------------------

interface ResolvedAnalysis extends DeepSeekAnalysis {
  /** Quota equa calcolata dal server: 1 / estimatedProbability. */
  fairOdds: number;
  /** Stato deciso dal SERVER (mai dal modello). */
  state: AnalysisState;
  bookmakerOdds: number | null;
  ev: number | null;
  bookmaker: string | null;
  /** Note della decisione server-side, persistite con l'analisi. */
  decisionNotes: string[];
}

/**
 * Verifica la scelta del modello contro le quote REALI e decide lo stato.
 *
 *  - il mercato/scelta deve essere supportato e presente nelle quote reali;
 *  - quota equa ed EV li calcola il SERVER (mai il modello);
 *  - lo stato finale (giocabile / scartata / da_valutare) lo decide
 *    `decideAnalysis` in base alla FONTE DATI e alle sue soglie:
 *      OpenFootball           -> EV >= 5%  e affidabilità >= 65
 *      fallback API-Football  -> EV >= 8%  e affidabilità >= 70
 *    Dati mancanti o mercato non validabile -> "da_valutare".
 */
function resolveAnalysisAgainstOdds(
  analysis: DeepSeekAnalysis,
  odds: FixtureOdds | null,
  statsSource: StatsSource
): ResolvedAnalysis {
  const code: MarketCode | null = parseModelSelection(
    analysis.market,
    analysis.selection
  );
  const quote = code && odds ? odds.byMarket[code] : undefined;
  const bookmakerOdds = quote ? quote.odd : null;
  const ev =
    bookmakerOdds != null
      ? computeEv(analysis.estimatedProbability, bookmakerOdds)
      : null;

  const decision = decideAnalysis({
    statsSource,
    ev,
    confidence: analysis.confidence,
    hasRealOdds: bookmakerOdds != null,
    marketSupported: code != null,
  });

  // Senza quota reale l'affidabilità non può restare alta.
  const confidence =
    bookmakerOdds != null
      ? analysis.confidence
      : Math.min(analysis.confidence, 50);

  const spec = code ? getMarket(code) : undefined;

  return {
    ...analysis,
    market: spec?.modelMarket ?? analysis.market,
    selection: spec?.modelSelection ?? analysis.selection,
    fairOdds: computeFairOdds(analysis.estimatedProbability),
    state: decision.state,
    confidence,
    bookmakerOdds,
    ev,
    bookmaker: quote ? (odds?.bookmaker ?? null) : null,
    decisionNotes: decision.notes,
  };
}

/** Inserisce/aggiorna l'analisi. Tollerante se la migration 004 non è ancora stata applicata. */
async function insertAnalysis(
  supabase: SupabaseClient,
  userId: string,
  matchId: string,
  a: ResolvedAnalysis,
  statsSource: StatsSource
): Promise<string | null> {
  // Motivazioni del modello + note della decisione server-side.
  const reasons = [...a.reasons, ...a.decisionNotes];

  const payload: Record<string, unknown> = {
    user_id: userId,
    match_id: matchId,
    market: a.market,
    selection: a.selection,
    analysis_odds: a.fairOdds || null,
    bet365_odds: a.bookmakerOdds,
    estimated_probability: a.estimatedProbability,
    fair_odds: a.fairOdds || null,
    ev: a.ev,
    confidence: a.confidence,
    risks: a.risks.length ? a.risks.join(" | ") : a.reasons.join(" | ") || null,
    state: a.state,
    source: statsSource ?? "deepseek",
    // Le note del motore decisionale vengono registrate con l'analisi, così
    // la motivazione della classificazione resta tracciabile.
    reasons: reasons.length ? reasons : null,
  };

  let { error } = await supabase
    .from("analyses")
    .upsert({ ...payload, bookmaker: a.bookmaker }, { onConflict: "user_id,match_id" });

  // La colonna `bookmaker` arriva con la migration 004: se non è ancora
  // applicata si salva il resto senza bloccare la pipeline.
  if (error && (error.code === "42703" || error.code === "PGRST204")) {
    ({ error } = await supabase
      .from("analyses")
      .upsert(payload, { onConflict: "user_id,match_id" }));
  }

  return error ? error.message : null;
}

// ------------------------------------------------------------
// ANALIZZA PARTITE
// ------------------------------------------------------------

export async function analyzeMatches(): Promise<AnalysisOutcome> {
  const auth = await resolveAdminContext();
  if (!auth.ok) {
    return { ok: false, status: "error", message: auth.message, candidatesFound: 0, analyzed: 0, analysesCreated: 0, requestsUsed: 0, deepseekCalls: 0, openFootball: 0, apiFallback: 0, oddsFound: 0, errors: [auth.message] };
  }
  const { userId, supabase } = auth.ctx;
  if (!isSportsApiConfigured()) {
    return { ok: false, status: "error", message: "SPORTS_API_KEY non configurata: le quote reali non sono recuperabili.", candidatesFound: 0, analyzed: 0, analysesCreated: 0, requestsUsed: 0, deepseekCalls: 0, openFootball: 0, apiFallback: 0, oddsFound: 0, errors: ["SPORTS_API_KEY non configurata"] };
  }
  if (!isDeepSeekConfigured()) {
    return { ok: false, status: "error", message: "DEEPSEEK_API_KEY non configurata sul server.", candidatesFound: 0, analyzed: 0, analysesCreated: 0, requestsUsed: 0, deepseekCalls: 0, openFootball: 0, apiFallback: 0, oddsFound: 0, errors: ["DEEPSEEK_API_KEY non configurata"] };
  }

  const candidates = await getAnalysisCandidates();
  if (candidates.length === 0) {
    return { ok: true, status: "ok", message: "Nessuna partita da analizzare: nessuna candidata in whitelist senza analisi.", candidatesFound: 0, analyzed: 0, analysesCreated: 0, requestsUsed: 0, deepseekCalls: 0, openFootball: 0, apiFallback: 0, oddsFound: 0, errors: [] };
  }

  const errors: string[] = [];
  let requestsUsed = 0;
  let deepseekCalls = 0;
  let analyzed = 0;
  let analysesCreated = 0;
  let openFootball = 0;
  let apiFallback = 0;
  let oddsFound = 0;
  let stoppedForQuota = false;

  // 1) Dataset OpenFootball: UNA fetch per lega distinta (con cache).
  const datasets = new Map<number, OpenFootballLeague>();
  const leagueIds = [
    ...new Set(
      candidates
        .map((m) => m.leagueId)
        .filter((id): id is number => id != null && id in OPENFOOTBALL_DATASETS)
    ),
  ];
  for (const leagueId of leagueIds) {
    try {
      datasets.set(leagueId, await loadLeague(leagueId));
    } catch (err) {
      errors.push(
        `dataset OpenFootball lega ${leagueId}: ${
          err instanceof Error ? err.message : "non disponibile"
        }`
      );
    }
  }

  // 2) Una passata per partita: contesto -> quote -> DeepSeek -> validazione.
  for (const match of candidates) {
    const label = `${match.homeTeam} vs ${match.awayTeam}`;

    if (!sportsThrottle.canSpend(2)) {
      stoppedForQuota = true;
      errors.push(
        "quota API-Football insufficiente: analisi interrotta prima di intaccare la riserva."
      );
      break;
    }

    try {
      const extId = Number(match.externalId);
      if (!Number.isFinite(extId)) {
        errors.push(`${label}: external_id non valido`);
        continue;
      }

      // 2a) Contesto: OpenFootball, altrimenti fallback leggero.
      const league =
        match.leagueId != null ? datasets.get(match.leagueId) : undefined;
      let ctx = league ? buildOpenFootballContext(match, league) : null;
      if (ctx) {
        openFootball += 1;
      } else {
        const prediction = await fetchPrediction(extId);
        requestsUsed += 1;
        if (prediction) apiFallback += 1;
        ctx = buildFallbackContext(match, prediction);
      }

      // 2b) Quote REALI: 1 richiesta per partita.
      let odds: FixtureOdds | null = null;
      try {
        odds = await fetchFixtureOdds(extId);
      } catch (err) {
        errors.push(
          `${label}: quote non recuperate (${
            err instanceof Error ? err.message : "errore"
          })`
        );
      }
      requestsUsed += 1;
      ctx.odds = odds;
      if (odds) oddsFound += 1;

      if (!hasEnoughContext(ctx)) {
        errors.push(`${label}: nessun contesto disponibile (partita lasciata in attesa)`);
        if (sportsThrottle.isRateLimited()) break;
        continue;
      }

      // 2c) DeepSeek.
      const analysis = await analyzeMatchWithDeepSeek(ctx);
      deepseekCalls += 1;
      if (!analysis) {
        errors.push(`${label}: DeepSeek non ha restituito un'analisi valida`);
        if (sportsThrottle.isRateLimited()) break;
        continue;
      }
      analyzed += 1;

      // 2d) Validazione contro le quote reali + decisione server-side.
      const resolved = resolveAnalysisAgainstOdds(analysis, odds, ctx.statsSource);
      const insertError = await insertAnalysis(
        supabase,
        userId,
        match.id,
        resolved,
        ctx.statsSource
      );
      if (insertError) {
        errors.push(`${label}: salvataggio fallito (${insertError})`);
      } else {
        analysesCreated += 1;
      }

      if (sportsThrottle.isRateLimited()) break;
    } catch (err) {
      errors.push(`${label}: ${err instanceof Error ? err.message : "errore imprevisto"}`);
    }
  }

  const status =
    sportsThrottle.isRateLimited() || stoppedForQuota
      ? "partial"
      : errors.length > 0 && analysesCreated > 0
        ? "partial"
        : errors.length > 0
          ? "error"
          : "ok";

  try {
    await supabase.from("analysis_runs").insert({
      user_id: userId,
      sync_date: todayIsoDate(),
      candidates_found: candidates.length,
      analyzed,
      analyses_created: analysesCreated,
      requests_used: requestsUsed,
      deepseek_calls: deepseekCalls,
      status,
      error_message: errors.length > 0 ? errors.join(" | ").slice(0, 1000) : null,
    });
  } catch {
    // ignora: il log è accessorio
  }

  revalidatePath("/", "layout");

  return {
    ok: status !== "error",
    status,
    message:
      analysesCreated > 0
        ? `${analysesCreated} analisi su ${candidates.length} candidate · OpenFootball: ${openFootball} · fallback API: ${apiFallback} · quote reali: ${oddsFound}.`
        : `Nessuna analisi creata (${candidates.length} candidate, ${errors.length} problemi).`,
    candidatesFound: candidates.length,
    analyzed,
    analysesCreated,
    requestsUsed,
    deepseekCalls,
    openFootball,
    apiFallback,
    oddsFound,
    errors: errors.slice(0, 10),
  };
}

// ------------------------------------------------------------
// AGGIORNA + ANALIZZA (sequenza)
// ------------------------------------------------------------

export async function runFullPipeline(): Promise<AnalysisOutcome> {
  const sync = await syncFixtures();

  if (sync.status !== "ok") {
    return {
      ok: false,
      status: "error",
      message: `Import non riuscito: ${sync.message}`,
      candidatesFound: 0,
      analyzed: 0,
      analysesCreated: 0,
      requestsUsed: sync.requestsUsed,
      deepseekCalls: 0,
      openFootball: 0,
      apiFallback: 0,
      oddsFound: 0,
      errors: [sync.message],
    };
  }

  const analysis = await analyzeMatches();

  return {
    ...analysis,
    message: `Import: ${sync.message} · Analisi: ${analysis.message}`,
    requestsUsed: sync.requestsUsed + analysis.requestsUsed,
  };
}

// ------------------------------------------------------------
// SETTLEMENT AUTOMATICO
// ------------------------------------------------------------

export interface SettlementReport {
  settled: number;
  leftOpen: number;
  errors: string[];
}

/**
 * Chiude automaticamente le giocate aperte delle partite concluse usando
 * SOLO il risultato finale. Se il mercato non è riconosciuto la giocata
 * resta APERTA e il problema viene segnalato: non si indovina mai.
 * Non è possibile liquidare due volte (si parte solo da status 'open').
 */
async function settleOpenBets(
  supabase: SupabaseClient,
  userId: string
): Promise<SettlementReport> {
  const report: SettlementReport = { settled: 0, leftOpen: 0, errors: [] };

  const { data: openBets } = await supabase
    .from("bets")
    .select("id, match_id, analysis_id, market, selection, odds, stake, status")
    .eq("user_id", userId)
    .eq("status", "open")
    .limit(200);

  const bets = openBets ?? [];
  if (bets.length === 0) return report;

  const matchIds = [...new Set(bets.map((b) => b.match_id))];
  const { data: matchRows } = await supabase
    .from("matches")
    .select("id, status, home_score, away_score")
    .in("id", matchIds);

  const matchesById = new Map((matchRows ?? []).map((m) => [m.id, m]));
  const closedAnalysisIds = new Set<string>();

  for (const bet of bets) {
    const match = matchesById.get(bet.match_id);
    if (!match || match.status !== "finished") continue;
    if (match.home_score == null || match.away_score == null) continue;

    const code = parseModelSelection(bet.market, bet.selection);
    const outcome = code
      ? settleMarket(code, Number(match.home_score), Number(match.away_score))
      : null;

    if (!code || !outcome) {
      report.leftOpen += 1;
      report.errors.push(
        `giocata ${bet.id}: mercato non liquidabile ("${bet.market}" / "${bet.selection}") — lasciata aperta`
      );
      continue;
    }

    const stake = Number(bet.stake) || 0;
    const odds = Number(bet.odds) || 0;
    const profit =
      outcome === "won"
        ? Number((stake * (odds - 1)).toFixed(2))
        : Number((-stake).toFixed(2));

    const { error } = await supabase
      .from("bets")
      .update({
        status: outcome === "won" ? "won" : "lost",
        profit,
        settled_at: new Date().toISOString(),
      })
      .eq("id", bet.id)
      .eq("user_id", userId)
      .eq("status", "open"); // guardia: nessun settlement doppio

    if (error) {
      report.errors.push(`giocata ${bet.id}: ${error.message}`);
      continue;
    }
    report.settled += 1;
    if (bet.analysis_id) closedAnalysisIds.add(bet.analysis_id);
  }

  // Le analisi delle giocate chiuse passano a "chiusa".
  for (const analysisId of closedAnalysisIds) {
    const { error } = await supabase
      .from("analyses")
      .update({ state: "chiusa" })
      .eq("id", analysisId)
      .eq("user_id", userId);
    if (error) report.errors.push(`analisi ${analysisId}: ${error.message}`);
  }

  return report;
}

/** Liquidazione delle giocate già maturabili (usata dal job giornaliero). */
export async function settleFinishedBets(): Promise<SettlementReport> {
  const auth = await resolveAdminContext();
  if (!auth.ok) return { settled: 0, leftOpen: 0, errors: [auth.message] };
  return settleOpenBets(auth.ctx.supabase, auth.ctx.userId);
}

// ------------------------------------------------------------
// AGGIORNA RISULTATI (+ settlement)
// ------------------------------------------------------------

export async function updateResults(): Promise<ResultsOutcome> {
  const auth = await resolveAdminContext();
  if (!auth.ok) {
    return { ok: false, message: auth.message, requestsUsed: 0, updated: 0, finished: 0, settled: 0, leftOpen: 0, errors: [auth.message] };
  }
  const { userId, supabase } = auth.ctx;
  if (!isSportsApiConfigured()) {
    return { ok: false, message: "SPORTS_API_KEY non configurata.", requestsUsed: 0, updated: 0, finished: 0, settled: 0, leftOpen: 0, errors: ["SPORTS_API_KEY non configurata"] };
  }

  const { data: matches } = await supabase
    .from("matches")
    .select("id, external_id, status, kickoff_at")
    .eq("user_id", userId)
    .not("external_id", "is", null)
    .neq("status", "finished");

  const rows = matches ?? [];
  const errors: string[] = [];
  let requestsUsed = 0;
  let updated = 0;
  let finished = 0;

  // Piano Free API-Football: il parametro `ids` non è disponibile.
  // Recuperiamo quindi i risultati per DATA (endpoint consentito sul Free)
  // e riconciliamo localmente tramite external_id.
  const romeDateFormatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Rome",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const toRomeIsoDate = (value: unknown): string | null => {
    if (typeof value !== "string") return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    const parts = romeDateFormatter.formatToParts(date);
    const year = parts.find((p) => p.type === "year")?.value;
    const month = parts.find((p) => p.type === "month")?.value;
    const day = parts.find((p) => p.type === "day")?.value;
    return year && month && day ? `${year}-${month}-${day}` : null;
  };

  const today = todayIsoDate();
  const rowsByDate = new Map<string, typeof rows>();
  for (const row of rows) {
    const date = toRomeIsoDate(row.kickoff_at);
    // Le partite future non hanno risultati da aggiornare. Le rinviate
    // verranno riprese dal normale sync quando compariranno sulla nuova data.
    if (!date || date > today) continue;
    const bucket = rowsByDate.get(date) ?? [];
    bucket.push(row);
    rowsByDate.set(date, bucket);
  }

  const resultDates = [...rowsByDate.keys()].sort();

  for (const date of resultDates) {
    if (!sportsThrottle.canSpend(1)) {
      errors.push("quota API-Football insufficiente: aggiornamento risultati interrotto.");
      break;
    }

    try {
      requestsUsed += 1;
      const result = await fetchFixturesByDate(date);
      const byExternal = new Map(
        result.fixtures.map((f) => [String(f.fixture.id), f])
      );

      for (const row of rowsByDate.get(date) ?? []) {
        const fx = byExternal.get(String(row.external_id));
        if (!fx) continue;

        const status = mapFixtureStatus(fx.fixture.status.short);
        const isFinished = status === "finished";
        const homeScore = isFinished ? (fx.goals?.home ?? null) : null;
        const awayScore = isFinished ? (fx.goals?.away ?? null) : null;

        const { error } = await supabase
          .from("matches")
          .update({ status, home_score: homeScore, away_score: awayScore })
          .eq("id", row.id)
          .eq("user_id", userId);

        if (error) {
          errors.push(`${row.id}: ${error.message}`);
        } else {
          updated += 1;
          if (isFinished) finished += 1;
        }
      }
    } catch (err) {
      errors.push(
        `${date}: ${err instanceof Error ? err.message : "errore durante il recupero risultati"}`
      );
    }
  }

  // Settlement: passata separata su TUTTE le giocate aperte con partita
  // conclusa. Così anche un esito non liquidato in una run precedente viene
  // recuperato (la partita, ormai 'finished', non rientrerebbe più sopra).
  const settlement = await settleOpenBets(supabase, userId);
  errors.push(...settlement.errors);

  revalidatePath("/", "layout");

  const settledNote = settlement.settled > 0 ? `, ${settlement.settled} giocate chiuse` : "";
  const openNote = settlement.leftOpen > 0 ? `, ${settlement.leftOpen} non liquidabili` : "";

  return {
    ok: errors.length === 0,
    message: `${updated} partite aggiornate${finished > 0 ? ` (${finished} terminate)` : ""}${settledNote}${openNote}.`,
    requestsUsed,
    updated,
    finished,
    settled: settlement.settled,
    leftOpen: settlement.leftOpen,
    errors: errors.slice(0, 10),
  };
}
