// ============================================================
// Competizioni seguite — ID ufficiali di API-Football (api-sports.io)
//
// Distinte in CLUB (competizioni per club) e NAZIONALI (competizioni
// tra nazionali). Il filtro di import è LOCALE: confrontiamo l'ID del
// campionato restituito da /fixtures con questa whitelist. Aggiungere
// competizioni qui NON aumenta il numero di richieste API.
//
// NOTA sugli ID: quelli dei club sono stabili e già verificati. Gli ID
// delle competizioni per nazionali (soprattutto le qualificazioni 31/32/34)
// vanno confermati al primo utilizzo reale: la sincronizzazione mostra
// comunque "Campionati presenti nella risposta" con gli ID reali, così è
// facile correggerli se non coincidono.
// Le amichevoli internazionali restano VOLUTAMENTE escluse.
// ============================================================

export type LeagueKind = "club" | "national";

export interface TrackedLeague {
  id: number;
  name: string;
  kind: LeagueKind;
}

export const TRACKED_LEAGUES: TrackedLeague[] = [
  // — CLUB —
  { id: 135, name: "Serie A", kind: "club" },
  { id: 136, name: "Serie B", kind: "club" },
  { id: 39, name: "Premier League", kind: "club" },
  { id: 40, name: "Championship", kind: "club" },
  { id: 140, name: "La Liga", kind: "club" },
  { id: 78, name: "Bundesliga", kind: "club" },
  { id: 61, name: "Ligue 1", kind: "club" },
  { id: 2, name: "UEFA Champions League", kind: "club" },
  { id: 3, name: "UEFA Europa League", kind: "club" },
  { id: 848, name: "UEFA Conference League", kind: "club" },

  // — NAZIONALI —
  { id: 1, name: "FIFA World Cup", kind: "national" },
  { id: 32, name: "World Cup Qualifiers - Europe", kind: "national" },
  { id: 34, name: "World Cup Qualifiers - South America", kind: "national" },
  { id: 5, name: "UEFA Nations League", kind: "national" },
  { id: 4, name: "European Championship", kind: "national" },
  { id: 31, name: "Euro Qualifiers", kind: "national" },
  { id: 9, name: "Copa America", kind: "national" },
];

const BY_ID = new Map<number, TrackedLeague>(
  TRACKED_LEAGUES.map((l) => [l.id, l])
);

export function getTrackedLeague(id: number): TrackedLeague | undefined {
  return BY_ID.get(id);
}

/** Tipo di una competizione (club/nazionali) a partire dal suo id. */
export function getLeagueKind(
  id: number | null | undefined
): LeagueKind | null {
  if (id == null) return null;
  return BY_ID.get(id)?.kind ?? null;
}

export function isTrackedLeague(id: number): boolean {
  return BY_ID.has(id);
}
