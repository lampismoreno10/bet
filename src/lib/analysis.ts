// ============================================================
// Pre-filtro locale delle partite candidate all'analisi.
//
// Serve a LIMITARE il consumo delle API: selezioniamo in locale solo
// un numero contenuto di partite (imminenti, della whitelist e senza
// analisi), così il passo "contesto + quote + DeepSeek" non gira su tutte
// le partite del mondo ma su un sottoinsieme piccolo e rilevante.
// ============================================================

import { TRACKED_LEAGUES } from "@/lib/sports/leagues";
import type { Match } from "@/types";

export const DEFAULT_MAX_CANDIDATES = 8;

/** Stagione supportata dalla pipeline (i dataset OpenFootball coprono 2026/27). */
export const SUPPORTED_ANALYSIS_SEASON = 2026;

// ------------------------------------------------------------
// Competizioni eleggibili: TUTTA la whitelist.
//
// Per ognuna la pipeline sceglie da sola la fonte di contesto:
//   - OpenFootball, se esiste un dataset configurato per quella lega;
//   - altrimenti il fallback leggero di API-Football (/predictions).
//
// Il tetto MAX_ANALYSIS_PER_RUN è applicato DOPO questo filtro, così le
// partite fuori whitelist non occupano i posti disponibili.
// ------------------------------------------------------------

/** Id delle competizioni eleggibili (per il filtro in query). */
export function supportedLeagueIds(): number[] {
  return TRACKED_LEAGUES.map((l) => l.id);
}

/**
 * True se la partita è eleggibile all'analisi: competizione in whitelist e
 * stagione allineata. `season` null è accettato (import senza stagione).
 */
export function isSupportedForAnalysis(match: Match): boolean {
  if (match.leagueId == null) return false;
  if (!TRACKED_LEAGUES.some((l) => l.id === match.leagueId)) return false;
  return match.season == null || match.season === SUPPORTED_ANALYSIS_SEASON;
}

/** Numero massimo di candidate per singola esecuzione (configurabile via env). */
export function maxCandidates(): number {
  const v = Number(process.env.MAX_ANALYSIS_PER_RUN);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : DEFAULT_MAX_CANDIDATES;
}

/**
 * Pre-filtro locale: tiene solo le partite in programma o in corso
 * (non terminate), le ordina per calcio d'inizio e ne tiene al massimo
 * `max`. Nessuna chiamata API.
 *
 * Il taglio a `max` avviene DOPO i filtri: è il chiamante a passare solo le
 * partite eleggibili, così le competizioni non supportate non occupano i posti.
 */
export function selectCandidates(
  matches: Match[],
  max: number = maxCandidates()
): Match[] {
  return matches
    .filter((m) => m.state === "scheduled" || m.state === "live")
    .sort((a, b) => a.kickoffAt.localeCompare(b.kickoffAt))
    .slice(0, max);
}
