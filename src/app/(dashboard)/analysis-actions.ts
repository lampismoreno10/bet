"use server";

// ============================================================
// Operazioni operative (solo server, solo admin):
//   - analyzeMatches   -> analisi dai soli dati locali (NESSUNA chiamata API-Football)
//   - runFullPipeline  -> sync + analisi in sequenza
//   - updateResults    -> aggiorna stato e risultato delle partite
// ============================================================

import { revalidatePath } from "next/cache";

import { syncFixtures } from "@/app/(dashboard)/sync-actions";
import { isAdminEmail } from "@/lib/config";
import { getAnalysisCandidates } from "@/lib/data";
import { todayIsoDate } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";
import {
  analyzeMatchWithDeepSeek,
  isDeepSeekConfigured,
  type DeepSeekAnalysis,
  type MatchContext,
} from "@/lib/ai/deepseek";
import {
  fetchFixturesByIds,
  isSportsApiConfigured,
  type StandingRow,
  type TeamStatistics,
} from "@/lib/sports/api-football";
import {
  loadSerieA2026_27,
  resolveOpenFootballTeam,
  type OpenFootballLeague,
  type OpenFootballMatchResult,
  type OpenFootballTeamStats,
} from "@/lib/sports/openfootball";
import type {
  AnalysisOutcome,
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

async function requireAdmin(): Promise<{ ok: true; userId: string } | { ok: false; message: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { ok: false, message: "Non autenticato." };
  if (!isAdminEmail(user.email)) {
    return { ok: false, message: "Solo un amministratore può eseguire questa operazione." };
  }
  return { ok: true, userId: user.id };
}

// ------------------------------------------------------------
// ANALIZZA PARTITE
//
// ⚠️ Questa operazione NON effettua NESSUNA richiesta ad API-Football.
// API-Football è riservata alla sola sincronizzazione delle partite
// ("Aggiorna partite", sync-actions.ts) e a "Aggiorna risultati".
//
// L'arricchimento viene da una fonte alternativa: OpenFootball /
// football.json (CC0, nessuna API key, nessuno scraping HTML).
// Il dataset della lega è un file statico: viene scaricato UNA sola volta
// per esecuzione, mai una volta per partita. Per ora è supportata solo la
// Serie A italiana 2026/27.
//
// Se una squadra non viene riconosciuta, o se la fonte non è disponibile,
// la partita resta "in attesa di analisi" e DeepSeek NON viene interrogato.
// Nessun dato viene inventato.
// ------------------------------------------------------------

// La definizione di "competizione supportata" vive in `lib/analysis.ts`
// (SUPPORTED_ANALYSIS_LEAGUES). È lì che il pre-filtro delle candidate la
// applica, così il tetto MAX_ANALYSIS_PER_RUN non viene occupato dalle
// partite di competizioni non ancora supportate: quelle restano in attesa
// senza essere toccate.

/** Contesto vuoto: nessun dato di arricchimento, nessuna invenzione. */
function emptyContext(match: Match): MatchContext {
  return {
    homeTeam: match.homeTeam,
    awayTeam: match.awayTeam,
    competition: match.competition,
    kickoffAt: match.kickoffAt,
    homeStats: null,
    awayStats: null,
    h2h: null,
    standings: null,
    homeInjuries: null,
    awayInjuries: null,
    odds: null,
  };
}

const RESULT_LABEL = { W: "V", D: "N", L: "P" } as const;

/** Una riga leggibile per il prompt, es. "V 2-1 vs Como 1907 (casa)". */
function formatLast5Entry(entry: OpenFootballMatchResult): string {
  const venue = entry.home ? "casa" : "trasferta";
  return `${RESULT_LABEL[entry.result]} ${entry.goalsFor}-${entry.goalsAgainst} vs ${entry.opponent} (${venue})`;
}

/** Adatta le statistiche OpenFootball al vocabolario condiviso del contesto. */
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
 * Classifica calcolata dai risultati giocati.
 *
 * Le due squadre in campo vengono rinominate con il nome come è salvato in
 * `matches` (es. "Inter" invece di "FC Internazionale Milano"): così la riga
 * di classifica corrisponde a `homeTeam`/`awayTeam` del resto del contesto e
 * il filtro sulla classifica nel prompt le riconosce.
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
 * Costruisce il contesto di una partita dai dati OpenFootball già in memoria.
 * Entrambe le squadre devono essere riconosciute: se anche una sola non lo è,
 * il contesto resta vuoto e la partita rimane in attesa.
 */
function buildMatchContext(match: Match, league: OpenFootballLeague): MatchContext {
  const ctx = emptyContext(match);

  const homeKey = resolveOpenFootballTeam(match.homeTeam, league);
  const awayKey = resolveOpenFootballTeam(match.awayTeam, league);
  if (!homeKey || !awayKey) return ctx;

  const home = league.teams.get(homeKey);
  const away = league.teams.get(awayKey);
  if (!home || !away) return ctx;

  return {
    ...ctx,
    homeStats: toTeamStatistics(home),
    awayStats: toTeamStatistics(away),
    standings: toStandingRows(league, homeKey, awayKey, match),
  };
}

/**
 * True solo se il contesto contiene i dati necessari per interrogare DeepSeek:
 * servono ENTRAMBE le squadre. Con una sola squadra i dati sono insufficienti
 * e la partita resta in attesa.
 */
function hasEnoughContext(ctx: MatchContext): boolean {
  return Boolean(ctx.homeStats && ctx.awayStats);
}

export async function analyzeMatches(): Promise<AnalysisOutcome> {
  const auth = await requireAdmin();
  if (!auth.ok) {
    return { ok: false, status: "error", message: auth.message, candidatesFound: 0, analyzed: 0, analysesCreated: 0, requestsUsed: 0, deepseekCalls: 0, errors: [auth.message] };
  }

  // Solo partite di competizioni supportate: le altre restano in attesa.
  const candidates = await getAnalysisCandidates();
  if (candidates.length === 0) {
    return { ok: true, status: "ok", message: "Nessuna partita da analizzare: nessuna candidata delle competizioni supportate (Serie A 2026/27).", candidatesFound: 0, analyzed: 0, analysesCreated: 0, requestsUsed: 0, deepseekCalls: 0, errors: [] };
  }

  const supabase = await createClient();
  const userId = auth.userId;

  async function insertAnalysis(matchId: string, a: DeepSeekAnalysis) {
    const { error } = await supabase.from("analyses").upsert(
      {
        user_id: userId,
        match_id: matchId,
        market: a.market,
        selection: a.selection,
        analysis_odds: a.fairOdds || null,
        bet365_odds: a.bookmakerOdds || null,
        estimated_probability: a.estimatedProbability,
        fair_odds: a.fairOdds || null,
        ev: a.ev,
        confidence: a.confidence,
        risks: a.risks.length ? a.risks.join(" | ") : a.reasons.join(" | ") || null,
        state: a.state,
        source: "deepseek",
        reasons: a.reasons.length ? a.reasons : null,
      },
      { onConflict: "user_id,match_id" }
    );
    return error;
  }

  // Fonte alternativa: UNA sola richiesta HTTP per esecuzione. Le candidate
  // sono già filtrate per competizione supportata da `getAnalysisCandidates`.
  let league: OpenFootballLeague | null = null;
  let sourceError: string | null = null;
  if (candidates.length > 0) {
    try {
      league = await loadSerieA2026_27();
    } catch (err) {
      sourceError =
        err instanceof Error ? err.message : "fonte OpenFootball non raggiungibile";
    }
  }

  // Nessuna chiamata API-Football: il contesto viene costruito solo dai dati
  // OpenFootball già in memoria. Se una squadra non è riconosciuta,
  // `buildMatchContext` restituisce un contesto vuoto (partita in attesa).
  const prepared = candidates.map((match) => ({
    match,
    ctx: league ? buildMatchContext(match, league) : emptyContext(match),
  }));
  const ready = prepared.filter((p) => hasEnoughContext(p.ctx));
  const pending = prepared.length - ready.length;

  // Diagnostica: squadre delle candidate che non sono state riconosciute
  // (le loro partite restano in attesa).
  const unresolvedTeams = league
    ? [
        ...new Set(
          candidates
            .flatMap((m) => [m.homeTeam, m.awayTeam])
            .filter((name) => !resolveOpenFootballTeam(name, league))
        ),
      ]
    : [];

  // Nessuna candidata ha i dati necessari: non si chiama DeepSeek e non si
  // scrive nulla in `analyses`. Le partite restano in attesa di analisi.
  if (ready.length === 0) {
    const reason = sourceError
      ? `fonte OpenFootball non raggiungibile (${sourceError})`
      : unresolvedTeams.length > 0
        ? `squadre non riconosciute: ${unresolvedTeams.join(", ")}`
        : "nessun dato di contesto disponibile per le competizioni supportate";

    try {
      await supabase.from("analysis_runs").insert({
        user_id: userId,
        sync_date: todayIsoDate(),
        candidates_found: candidates.length,
        analyzed: 0,
        analyses_created: 0,
        requests_used: 0,
        deepseek_calls: 0,
        status: sourceError ? "partial" : "ok",
        error_message: sourceError,
      });
    } catch {
      // ignora: il log è accessorio
    }

    return {
      ok: true,
      status: sourceError ? "partial" : "ok",
      message: `${pending} partite restano in attesa di analisi: ${reason}.`,
      candidatesFound: candidates.length,
      analyzed: 0,
      analysesCreated: 0,
      requestsUsed: 0,
      deepseekCalls: 0,
      errors: sourceError ? [sourceError] : [],
    };
  }

  // Da qui in poi il percorso DeepSeek è invariato: si attiva solo per le
  // partite il cui contesto è stato popolato dalla fonte.
  if (!isDeepSeekConfigured()) {
    return { ok: false, status: "error", message: "DEEPSEEK_API_KEY non configurata sul server.", candidatesFound: candidates.length, analyzed: 0, analysesCreated: 0, requestsUsed: 0, deepseekCalls: 0, errors: ["DEEPSEEK_API_KEY non configurata"] };
  }

  let analyzed = 0;
  let analysesCreated = 0;
  let deepseekCalls = 0;
  const errors: string[] = [];

  for (const { match, ctx } of ready) {
    const label = `${match.homeTeam} vs ${match.awayTeam}`;
    try {
      const analysis = await analyzeMatchWithDeepSeek(ctx);
      deepseekCalls += 1;

      if (!analysis) {
        errors.push(`${label}: DeepSeek non ha restituito un'analisi valida`);
        continue;
      }

      const insertError = await insertAnalysis(match.id, analysis);
      if (insertError) {
        errors.push(`${label}: salvataggio fallito (${insertError.message})`);
      } else {
        analysesCreated += 1;
      }
      analyzed += 1;
    } catch (err) {
      errors.push(`${label}: ${err instanceof Error ? err.message : "errore imprevisto"}`);
    }
  }

  // Diagnostica: squadre non riconosciute fra le candidate supportate.
  if (unresolvedTeams.length > 0) {
    errors.push(
      `squadre non riconosciute (partite lasciate in attesa): ${unresolvedTeams.join(", ")}`
    );
  }

  // Log dell'operazione (accessorio, non deve bloccare).
  try {
    await supabase.from("analysis_runs").insert({
      user_id: userId,
      sync_date: todayIsoDate(),
      candidates_found: candidates.length,
      analyzed,
      analyses_created: analysesCreated,
      requests_used: 0,
      deepseek_calls: deepseekCalls,
      status: errors.length > 0 && analysesCreated > 0 ? "partial" : errors.length > 0 ? "error" : "ok",
      error_message: errors.length > 0 ? errors.join(" | ").slice(0, 1000) : null,
    });
  } catch {
    // ignora
  }

  revalidatePath("/", "layout");

  const status = errors.length > 0 && analysesCreated > 0 ? "partial" : errors.length > 0 ? "error" : "ok";
  return {
    ok: status !== "error",
    status,
    message:
      analysesCreated > 0
        ? `${analysesCreated} analisi create su ${ready.length} candidate con dati.`
        : `Nessuna analisi creata (${ready.length} candidate con dati, ${errors.length} problemi).`,
    candidatesFound: candidates.length,
    analyzed,
    analysesCreated,
    requestsUsed: 0,
    deepseekCalls,
    errors: errors.slice(0, 10),
  };
}

// ------------------------------------------------------------
// AGGIORNA + ANALIZZA (sequenza)
// ------------------------------------------------------------

export async function runFullPipeline(): Promise<AnalysisOutcome> {
  const sync = await syncFixtures();

  // Non proseguire con l'analisi se l'import è fallito (evita di bruciare
  // quota API e chiamate DeepSeek a vuoto).
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
// AGGIORNA RISULTATI
// ------------------------------------------------------------

export async function updateResults(): Promise<ResultsOutcome> {
  const auth = await requireAdmin();
  if (!auth.ok) {
    return { ok: false, message: auth.message, requestsUsed: 0, updated: 0, finished: 0, errors: [auth.message] };
  }
  if (!isSportsApiConfigured()) {
    return { ok: false, message: "SPORTS_API_KEY non configurata.", requestsUsed: 0, updated: 0, finished: 0, errors: ["SPORTS_API_KEY non configurata"] };
  }

  const supabase = await createClient();
  const userId = auth.userId;

  const { data: matches } = await supabase
    .from("matches")
    .select("id, external_id, status")
    .eq("user_id", userId)
    .not("external_id", "is", null)
    .neq("status", "finished");

  const rows = matches ?? [];
  if (rows.length === 0) {
    return { ok: true, message: "Nessuna partita da aggiornare.", requestsUsed: 0, updated: 0, finished: 0, errors: [] };
  }

  const ids = rows
    .map((r) => Number(r.external_id))
    .filter((n) => Number.isFinite(n));

  const CHUNK = 20;
  let requestsUsed = 0;
  let updated = 0;
  let finished = 0;
  const errors: string[] = [];

  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const chunkSet = new Set(chunk.map(String));
    const chunkRows = rows.filter((r) => chunkSet.has(String(r.external_id)));

    try {
      requestsUsed += 1;
      const fixtures = await fetchFixturesByIds(chunk);
      const byExternal = new Map(fixtures.map((f) => [String(f.fixture.id), f]));

      for (const row of chunkRows) {
        const fx = byExternal.get(String(row.external_id));
        if (!fx) continue;

        const status = mapFixtureStatus(fx.fixture.status.short);
        const isFinished = status === "finished";
        const homeScore = isFinished ? (fx.goals?.home ?? null) : null;
        const awayScore = isFinished ? (fx.goals?.away ?? null) : null;

        const { error } = await supabase
          .from("matches")
          .update({
            status,
            home_score: homeScore,
            away_score: awayScore,
          })
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
      errors.push(err instanceof Error ? err.message : "errore durante il recupero risultati");
    }
  }

  revalidatePath("/", "layout");

  return {
    ok: errors.length === 0,
    message: `${updated} partite aggiornate${finished > 0 ? ` (${finished} terminate)` : ""}.`,
    requestsUsed,
    updated,
    finished,
    errors: errors.slice(0, 10),
  };
}
