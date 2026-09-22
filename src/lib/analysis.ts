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

/** Numero massimo di candidate per singola esecuzione (configurabile via env). */
export function maxCandidates(): number {
  const v = Number(process.env.MAX_ANALYSIS_PER_RUN);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : DEFAULT_MAX_CANDIDATES;
}

/**
 * Pre-filtro locale: tiene solo le partite in programma o in corso
 * (non terminate), le ordina per calcio d'inizio e ne tiene al massimo
 * `max`. Nessuna chiamata API.
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
