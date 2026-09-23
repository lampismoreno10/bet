// ============================================================
// Pre-filtro locale delle partite candidate all'analisi.
//
// Serve a LIMITARE il consumo delle API: selezioniamo in locale solo
// un numero contenuto di partite (imminenti e senza analisi), così il
// passo "recupero dati approfonditi + DeepSeek" non gira su tutte le
// partite del mondo ma su un sottoinsieme piccolo e rilevante.
// ============================================================

import type { Match } from "@/types";

export const DEFAULT_MAX_CANDIDATES = 8;

// ------------------------------------------------------------
// Competizioni attualmente supportate dall'arricchimento (OpenFootball).
//
// Le partite delle altre competizioni NON vengono toccate: restano
// semplicemente in attesa finché non avranno una fonte dati compatibile.
// Aggiungere una competizione qui la rende eleggibile all'analisi.
// ------------------------------------------------------------
export const SUPPORTED_ANALYSIS_LEAGUES: ReadonlyArray<{
  leagueId: number;
  season: number;
}> = [
  { leagueId: 135, season: 2026 }, // Serie A 2026/27
];

/** Id delle competizioni supportate (per il filtro in query). */
export function supportedLeagueIds(): number[] {
  return SUPPORTED_ANALYSIS_LEAGUES.map((l) => l.leagueId);
}

/**
 * True se la partita appartiene a una competizione supportata dall'analisi.
 * `season` null è accettato: gli import senza stagione restano eleggibili.
 */
export function isSupportedForAnalysis(match: Match): boolean {
  const supported = SUPPORTED_ANALYSIS_LEAGUES.find(
    (l) => l.leagueId === match.leagueId
  );
  if (!supported) return false;
  return match.season == null || match.season === supported.season;
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
