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
//
// ⚠️ Questa operazione NON effettua NESSUNA richiesta ad API-Football.
// API-Football è riservata alla sola sincronizzazione delle partite
// ("Aggiorna partite", sync-actions.ts).
//
// Qui l'analisi lavora esclusivamente sui dati di contesto disponibili
// localmente. Finché non viene collegata una fonte alternativa il
// contesto è vuoto: le partite restano "in attesa di analisi" e DeepSeek
// NON viene interrogato. Non si inventano dati mancanti.
// ------------------------------------------------------------

/**
 * Costruisce il contesto di una partita SENZA alcuna chiamata esterna.
 * Una futura fonte alternativa (non API-Football) dovrà popolare qui i
 * blocchi di arricchimento; per ora restano tutti vuoti.
 */
function buildMatchContext(match: Match): MatchContext {
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

/**
 * True solo se il contesto contiene almeno un dato di arricchimento reale.
 * Impedisce di chiamare DeepSeek quando i dati necessari mancano.
 */
function hasEnoughContext(ctx: MatchContext): boolean {
  return Boolean(
    ctx.homeStats ||
      ctx.awayStats ||
      (ctx.h2h && ctx.h2h.length > 0) ||
      (ctx.standings && ctx.standings.length > 0) ||
      (ctx.homeInjuries && ctx.homeInjuries.length > 0) ||
      (ctx.awayInjuries && ctx.awayInjuries.length > 0) ||
      ctx.odds
  );
}

export async function analyzeMatches(): Promise<AnalysisOutcome> {
  const auth = await requireAdmin();
  if (!auth.ok) {
    return { ok: false, status: "error", message: auth.message, candidatesFound: 0, analyzed: 0, analysesCreated: 0, requestsUsed: 0, deepseekCalls: 0, errors: [auth.message] };
  }

  const candidates = await getAnalysisCandidates();
  if (candidates.length === 0) {
    return { ok: true, status: "ok", message: "Nessuna partita da analizzare (nessuna candidata senza analisi).", candidatesFound: 0, analyzed: 0, analysesCreated: 0, requestsUsed: 0, deepseekCalls: 0, errors: [] };
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

  // Nessuna chiamata API-Football: il contesto è costruito solo da dati locali.
  const prepared = candidates.map((match) => ({
    match,
    ctx: buildMatchContext(match),
  }));
  const ready = prepared.filter((p) => hasEnoughContext(p.ctx));
  const pending = prepared.length - ready.length;

  // Nessuna candidata ha i dati necessari: non si chiama DeepSeek e non si
  // scrive nulla in `analyses`. Le partite restano in attesa di analisi.
  if (ready.length === 0) {
    try {
      await supabase.from("analysis_runs").insert({
        user_id: userId,
        sync_date: todayIsoDate(),
        candidates_found: candidates.length,
        analyzed: 0,
        analyses_created: 0,
        requests_used: 0,
        deepseek_calls: 0,
        status: "ok",
        error_message: null,
      });
    } catch {
      // ignora: il log è accessorio
    }

    return {
      ok: true,
      status: "ok",
      message: `${pending} partite restano in attesa di analisi: nessun dato di contesto disponibile (nessuna fonte collegata).`,
      candidatesFound: candidates.length,
      analyzed: 0,
      analysesCreated: 0,
      requestsUsed: 0,
      deepseekCalls: 0,
      errors: [],
    };
  }

  // Da qui in poi il percorso DeepSeek è invariato: si attiva solo quando una
  // fonte di arricchimento popolerà il contesto di almeno una partita.
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
