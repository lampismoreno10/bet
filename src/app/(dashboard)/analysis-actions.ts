"use server";

// ============================================================
// Operazioni operative (solo server, solo admin):
//   - analyzeMatches   -> pipeline analisi (pre-filtro -> dati -> DeepSeek -> salva)
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
  fetchFixtureOdds,
  fetchFixturesByIds,
  fetchHeadToHead,
  fetchInjuries,
  fetchStandings,
  fetchTeamStatistics,
  isSportsApiConfigured,
  type FixtureOdds,
  type HeadToHeadMatch,
  type InjuryInfo,
  type StandingRow,
  type TeamStatistics,
} from "@/lib/sports/api-football";
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
// ------------------------------------------------------------

export async function analyzeMatches(): Promise<AnalysisOutcome> {
  const auth = await requireAdmin();
  if (!auth.ok) {
    return { ok: false, status: "error", message: auth.message, candidatesFound: 0, analyzed: 0, analysesCreated: 0, requestsUsed: 0, deepseekCalls: 0, errors: [auth.message] };
  }
  if (!isSportsApiConfigured()) {
    return { ok: false, status: "error", message: "SPORTS_API_KEY non configurata.", candidatesFound: 0, analyzed: 0, analysesCreated: 0, requestsUsed: 0, deepseekCalls: 0, errors: ["SPORTS_API_KEY non configurata"] };
  }
  if (!isDeepSeekConfigured()) {
    return { ok: false, status: "error", message: "DEEPSEEK_API_KEY non configurata sul server.", candidatesFound: 0, analyzed: 0, analysesCreated: 0, requestsUsed: 0, deepseekCalls: 0, errors: ["DEEPSEEK_API_KEY non configurata"] };
  }

  const candidates = await getAnalysisCandidates();
  if (candidates.length === 0) {
    return { ok: true, status: "ok", message: "Nessuna partita da analizzare (nessuna candidata senza analisi).", candidatesFound: 0, analyzed: 0, analysesCreated: 0, requestsUsed: 0, deepseekCalls: 0, errors: [] };
  }

  const supabase = await createClient();
  const userId = auth.userId;

  let requestsUsed = 0;
  let deepseekCalls = 0;
  let analyzed = 0;
  let analysesCreated = 0;
  const errors: string[] = [];

  // Cache interne per non ripetere le stesse chiamate (stessa squadra/lega).
  const teamStatsCache = new Map<string, TeamStatistics | null>();
  const standingsCache = new Map<string, StandingRow[] | null>();
  const injuriesCache = new Map<number, InjuryInfo[] | null>();

  async function safe<T>(fn: () => Promise<T | null>): Promise<T | null> {
    requestsUsed += 1;
    try {
      return await fn();
    } catch {
      return null;
    }
  }

  async function teamStats(teamId: number, leagueId: number, season: number) {
    const key = `${teamId}:${leagueId}:${season}`;
    if (!teamStatsCache.has(key)) {
      teamStatsCache.set(key, await safe(() => fetchTeamStatistics(teamId, leagueId, season)));
    }
    return teamStatsCache.get(key) ?? null;
  }

  async function standings(leagueId: number, season: number) {
    const key = `${leagueId}:${season}`;
    if (!standingsCache.has(key)) {
      standingsCache.set(key, await safe(() => fetchStandings(leagueId, season)));
    }
    return standingsCache.get(key) ?? null;
  }

  async function injuries(teamId: number) {
    if (!injuriesCache.has(teamId)) {
      injuriesCache.set(teamId, await safe(() => fetchInjuries(teamId)));
    }
    return injuriesCache.get(teamId) ?? null;
  }

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

  for (const match of candidates) {
    const label = `${match.homeTeam} vs ${match.awayTeam}`;
    try {
      const extId = Number(match.externalId);
      if (!Number.isFinite(extId)) {
        errors.push(`${label}: external_id non valido`);
        continue;
      }

      // Risolvi id squadre / lega / season se mancanti (import vecchi).
      let leagueId = match.leagueId;
      let season = match.season;
      let homeId = match.homeTeamId;
      let awayId = match.awayTeamId;

      if (leagueId == null || season == null || homeId == null || awayId == null) {
        const fixtures = await safe(() => fetchFixturesByIds([extId]));
        const fx = fixtures?.[0];
        if (fx) {
          leagueId = fx.league?.id ?? leagueId;
          season = fx.league?.season ?? season;
          homeId = fx.teams?.home?.id ?? homeId;
          awayId = fx.teams?.away?.id ?? awayId;
        }
      }

      const homeStats = homeId != null && leagueId != null && season != null
        ? await teamStats(homeId, leagueId, season)
        : null;
      const awayStats = awayId != null && leagueId != null && season != null
        ? await teamStats(awayId, leagueId, season)
        : null;
      const h2h: HeadToHeadMatch[] | null = homeId != null && awayId != null
        ? await safe(() => fetchHeadToHead(homeId as number, awayId as number))
        : null;
      const table = leagueId != null && season != null
        ? await standings(leagueId, season)
        : null;
      const homeInjuries = homeId != null ? await injuries(homeId) : null;
      const awayInjuries = awayId != null ? await injuries(awayId) : null;
      const odds: FixtureOdds | null = await safe(() => fetchFixtureOdds(extId));

      const ctx: MatchContext = {
        homeTeam: match.homeTeam,
        awayTeam: match.awayTeam,
        competition: match.competition,
        kickoffAt: match.kickoffAt,
        homeStats,
        awayStats,
        h2h,
        standings: table,
        homeInjuries,
        awayInjuries,
        odds,
      };

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

  // Log dell'operazione (accessorio, non deve bloccare).
  try {
    await supabase.from("analysis_runs").insert({
      user_id: userId,
      sync_date: todayIsoDate(),
      candidates_found: candidates.length,
      analyzed,
      analyses_created: analysesCreated,
      requests_used: requestsUsed,
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
        ? `${analysesCreated} analisi create su ${candidates.length} candidate.`
        : `Nessuna analisi creata (${candidates.length} candidate, ${errors.length} problemi).`,
    candidatesFound: candidates.length,
    analyzed,
    analysesCreated,
    requestsUsed,
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
