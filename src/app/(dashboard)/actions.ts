"use server";

// ============================================================
// Server Action: operazioni di scrittura sul database.
// Chiamate dai Client Component (pulsanti/forms).
// ============================================================

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import {
  asBookmakerOdds,
  computeEv,
  computeFairOdds,
} from "@/lib/sports/markets";
import type { AnalysisInput, AnalysisState, MatchInput } from "@/types";

/**
 * Quota bookmaker normalizzata, quota equa ed EV.
 * La quota equa è calcolabile dalla probabilità stimata; l'EV NO: senza una
 * quota bookmaker reale non esiste, quindi resta null (mai 0, mai -1).
 * La matematica è condivisa con la pipeline di analisi (lib/sports/markets).
 */
function derive(probability: number, bookmakerOdds: number | null | undefined) {
  const odds = asBookmakerOdds(bookmakerOdds);
  return {
    odds,
    fairOdds: computeFairOdds(probability),
    ev: computeEv(probability, odds),
  };
}

/**
 * Segna una partita come "giocata":
 * 1. verifica che l'analisi sia realmente giocabile e abbia una QUOTA REALE;
 * 2. verifica che non esista già una giocata per la stessa analisi;
 * 3. crea la bet (stato open) e porta l'analisi a "giocata".
 *
 * Non è più possibile creare una giocata con quota 0 o inventata.
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

  // 1) coerenza analisi <-> partita (entrambi arrivano dal client).
  if (analysis.match_id !== matchId) {
    return { error: "L'analisi non appartiene a questa partita." };
  }

  // 2) serve una QUOTA BOOKMAKER REALE (> 1): mai odds = 0.
  const realOdds = asBookmakerOdds(
    analysis.bet365_odds != null ? Number(analysis.bet365_odds) : null
  );
  if (realOdds == null) {
    return {
      error:
        "Quota bookmaker reale assente: la giocata non può essere registrata (nessuna quota inventata).",
    };
  }

  // 3) l'analisi deve essere realmente giocabile.
  if (analysis.state !== "giocabile") {
    return {
      error: `L'analisi non è giocabile (stato attuale: ${analysis.state}).`,
    };
  }

  // 4) nessuna giocata duplicata per la stessa analisi.
  const { data: existing } = await supabase
    .from("bets")
    .select("id")
    .eq("analysis_id", analysisId)
    .limit(1);
  if (existing && existing.length > 0) {
    return { error: "Esiste già una giocata per questa analisi." };
  }

  const { error: betError } = await supabase.from("bets").insert({
    user_id: user.id,
    match_id: matchId,
    analysis_id: analysisId,
    market: analysis.market,
    selection: analysis.selection,
    odds: realOdds,
    ev: analysis.ev ?? 0,
    stake: 0, // importo impostabile in fase di chiusura
    status: "open",
    profit: 0,
  });
  if (betError) {
    // 23505 = violazione del vincolo unique (user_id, analysis_id).
    if (betError.code === "23505") {
      return { error: "Esiste già una giocata per questa analisi." };
    }
    return { error: betError.message };
  }

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

  const { odds, fairOdds, ev } = derive(
    analysis.estimatedProbability,
    analysis.bet365Odds
  );

  const { error: analysisError } = await supabase.from("analyses").insert({
    user_id: user.id,
    match_id: created.id,
    market: analysis.market.trim(),
    selection: analysis.selection.trim(),
    analysis_odds: analysis.analysisOdds,
    bet365_odds: odds,
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

  const { odds, fairOdds, ev } = derive(
    analysis.estimatedProbability,
    analysis.bet365Odds
  );

  const { error } = await supabase
    .from("analyses")
    .update({
      market: analysis.market.trim(),
      selection: analysis.selection.trim(),
      analysis_odds: analysis.analysisOdds,
      bet365_odds: odds,
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

  // Nessun settlement doppio: si chiude solo una giocata ancora aperta.
  if (bet.status !== "open") {
    return { error: `La giocata è già stata chiusa (stato: ${bet.status}).` };
  }
  if (!Number.isFinite(stake) || stake < 0) {
    return { error: "Importo non valido." };
  }

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
    .eq("id", betId)
    .eq("user_id", user.id)
    .eq("status", "open"); // guardia contro la doppia chiusura
  if (error) return { error: error.message };

  revalidatePath("/", "layout");
  return { ok: true };
}
