// ============================================================
// Campionati seguiti — ID ufficiali di API-Football (api-sports.io)
//
// Gli ID sono quelli di API-Football: se un campionato non riporta
// partite, verificare l'ID su https://dashboard.api-football.com /
// endpoint /leagues. Sono volutamente in un unico posto così è
// facile correggerli senza toccare il resto del codice.
// ============================================================

export interface TrackedLeague {
  id: number;
  name: string;
}

export const TRACKED_LEAGUES: TrackedLeague[] = [
  { id: 135, name: "Serie A" },
  { id: 136, name: "Serie B" },
  { id: 39, name: "Premier League" },
  { id: 40, name: "Championship" },
  { id: 140, name: "La Liga" },
  { id: 78, name: "Bundesliga" },
  { id: 61, name: "Ligue 1" },
  { id: 2, name: "UEFA Champions League" },
  { id: 3, name: "UEFA Europa League" },
  { id: 848, name: "UEFA Conference League" },
];

const BY_ID = new Map<number, TrackedLeague>(
  TRACKED_LEAGUES.map((l) => [l.id, l])
);

export function getTrackedLeague(id: number): TrackedLeague | undefined {
  return BY_ID.get(id);
}

export function isTrackedLeague(id: number): boolean {
  return BY_ID.has(id);
}
