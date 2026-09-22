"use server";

// ============================================================
// Server Action: operazioni di scrittura sul database.
// Chiamate dai Client Component (pulsanti/forms).
// ============================================================

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import type { AnalysisInput, AnalysisState, MatchInput } from "@/types";

/** Quota equa e EV derivati da probabilità stimata e quota bookmaker. */
function derive(probability: number, bookmakerOdds: number) {
  const fairOdds = probability > 0 ? 1 / probability : 0;
  const ev = probability * bookmakerOdds - 1;
  return {
    fairOdds: Number(fairOdds.toFixed(2)),
    ev: Number(ev.toFixed(4)),
  };
}

/**
 * Segna una partita come "giocata":
 * 1. crea una bet (stato open) con i dati dell'analisi;
 * 2. aggiorna lo stato dell'analisi a "giocata".
 * La bet entra così automaticamente nel report/archivio.
 */
export async function markAsPlayed(
  matchId: string,
  analysisId: string
): Promise<{ error?: string; ok?: boolean }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Non autenticato" };

  const { data: analysis, error: analysisError } = await supabase
    .from("analyses")
    .select("*")
    .eq("id", analysisId)
    .maybeSingle();
  if (analysisError || !analysis) return { error: "Analisi non trovata" };

  const { error: betError } = await supabase.from("bets").insert({
    user_id: user.id,
    match_id: matchId,
    analysis_id: analysisId,
    market: analysis.market,
    selection: analysis.selection,
    odds: analysis.bet365_odds ?? 0,
    ev: analysis.ev ?? 0,
    stake: 0, // importo impostabile in fase di chiusura
    status: "open",
    profit: 0,
  });
  if (betError) return { error: betError.message };

  const { error: updateError } = await supabase
    .from("analyses")
    .update({ state: "giocata" })
    .eq("id", analysisId);
  if (updateError) return { error: updateError.message };

  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * Crea una nuova partita con la sua analisi.
 * Quota equa ed EV sono calcolati automaticamente da
 * probabilità stimata e quota bookmaker.
 */
export async function createMatchWithAnalysis(
  match: MatchInput,
  analysis: AnalysisInput
): Promise<{ error?: string; ok?: boolean; matchId?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Non autenticato" };

  if (!match.homeTeam.trim() || !match.awayTeam.trim()) {
    return { error: "Inserisci entrambe le squadre." };
  }
  if (!match.competition.trim()) {
    return { error: "Inserisci il campionato/competizione." };
  }

  const { data: created, error: matchError } = await supabase
    .from("matches")
    .insert({
      user_id: user.id,
      competition: match.competition.trim(),
      home_team: match.homeTeam.trim(),
      away_team: match.awayTeam.trim(),
      kickoff_at: match.kickoffAt,
      status: "scheduled",
    })
    .select("id")
    .single();

  if (matchError || !created) {
    return { error: matchError?.message ?? "Errore nel salvataggio della partita." };
  }

  const { fairOdds, ev } = derive(
    analysis.estimatedProbability,
    analysis.bet365Odds
  );

  const { error: analysisError } = await supabase.from("analyses").insert({
    user_id: user.id,
    match_id: created.id,
    market: analysis.market.trim(),
    selection: analysis.selection.trim(),
    analysis_odds: analysis.analysisOdds,
    bet365_odds: analysis.bet365Odds,
    estimated_probability: analysis.estimatedProbability,
    fair_odds: fairOdds,
    ev,
    confidence: analysis.confidence,
    risks: analysis.risks.trim(),
    state: analysis.state,
  });

  if (analysisError) return { error: analysisError.message };

  revalidatePath("/", "layout");
  return { ok: true, matchId: created.id };
}

/** Aggiorna i dati di una partita. */
export async function updateMatch(
  matchId: string,
  match: MatchInput
): Promise<{ error?: string; ok?: boolean }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Non autenticato" };

  if (!match.homeTeam.trim() || !match.awayTeam.trim()) {
    return { error: "Inserisci entrambe le squadre." };
  }

  const { error } = await supabase
    .from("matches")
    .update({
      competition: match.competition.trim(),
      home_team: match.homeTeam.trim(),
      away_team: match.awayTeam.trim(),
      kickoff_at: match.kickoffAt,
    })
    .eq("id", matchId);
  if (error) return { error: error.message };

  revalidatePath("/", "layout");
  return { ok: true };
}

/** Aggiorna l'analisi di una partita (ricalcola quota equa ed EV). */
export async function updateAnalysis(
  analysisId: string,
  analysis: AnalysisInput
): Promise<{ error?: string; ok?: boolean }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Non autenticato" };

  const { fairOdds, ev } = derive(
    analysis.estimatedProbability,
    analysis.bet365Odds
  );

  const { error } = await supabase
    .from("analyses")
    .update({
      market: analysis.market.trim(),
      selection: analysis.selection.trim(),
      analysis_odds: analysis.analysisOdds,
      bet365_odds: analysis.bet365Odds,
      estimated_probability: analysis.estimatedProbability,
      fair_odds: fairOdds,
      ev,
      confidence: analysis.confidence,
      risks: analysis.risks.trim(),
      state: analysis.state,
    })
    .eq("id", analysisId);

  if (error) return { error: error.message };

  revalidatePath("/", "layout");
  return { ok: true };
}

/** Cambia solo lo stato di un'analisi (Da valutare / Giocabile / Scartata). */
export async function updateAnalysisState(
  analysisId: string,
  state: AnalysisState
): Promise<{ error?: string; ok?: boolean }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Non autenticato" };

  const { error } = await supabase
    .from("analyses")
    .update({ state })
    .eq("id", analysisId);
  if (error) return { error: error.message };

  revalidatePath("/", "layout");
  return { ok: true };
}

/** Elimina una partita (analisi e giocate collegate seguono a cascata). */
export async function deleteMatch(
  matchId: string
): Promise<{ error?: string; ok?: boolean }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Non autenticato" };

  const { error } = await supabase.from("matches").delete().eq("id", matchId);
  if (error) return { error: error.message };

  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * Chiude una giocata: imposta importo, esito e calcola il profitto.
 * - won  -> profit = stake * (odds - 1)
 * - lost -> profit = -stake
 * - void -> profit = 0
 */
export async function settleBet(
  betId: string,
  status: "won" | "lost" | "void",
  stake: number
): Promise<{ error?: string; ok?: boolean }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Non autenticato" };

  const { data: bet, error: betError } = await supabase
    .from("bets")
    .select("*")
    .eq("id", betId)
    .maybeSingle();
  if (betError || !bet) return { error: "Giocata non trovata" };

  const odds = Number(bet.odds) || 1;
  const profit =
    status === "won" ? stake * (odds - 1) : status === "lost" ? -stake : 0;

  const { error } = await supabase
    .from("bets")
    .update({
      stake,
      status,
      profit,
      settled_at: new Date().toISOString(),
    })
    .eq("id", betId);
  if (error) return { error: error.message };

  revalidatePath("/", "layout");
  return { ok: true };
}
