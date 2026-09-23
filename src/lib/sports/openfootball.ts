// ============================================================
// Fonte dati alternativa: OpenFootball / football.json
//
// ⚠️ Questo modulo NON effettua alcuna chiamata ad API-Football.
// API-Football resta riservata alla sincronizzazione delle partite.
//
// Fonte: https://github.com/openfootball/football.json
// Licenza: CC0 / public domain. Nessuna API key.
//
// Per ora è supportata ESCLUSIVAMENTE la Serie A italiana 2026/27.
//
// Tutte le statistiche sono calcolate LOCALMENTE dal JSON, usando solo le
// partite che hanno già un risultato finale (`score.ft`). Nessun dato viene
// inventato: se un'informazione non è nel dataset, non viene prodotta.
//
// Il dataset è un file statico su raw.githubusercontent.com: viene scaricato
// UNA sola volta per esecuzione (con cache in memoria e dedup delle chiamate
// concorrenti), mai una volta per partita.
// ============================================================

export const OPENFOOTBALL_SERIE_A_2026_27_URL =
  "https://raw.githubusercontent.com/openfootball/football.json/master/2026-27/it.1.json";

/** Durata della cache in memoria: evita di riscaricare lo stesso JSON. */
export const OPENFOOTBALL_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minuti

export class OpenFootballError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpenFootballError";
  }
}

// ------------------------------------------------------------
// Forma grezza del dataset (tutto `unknown`: va validato prima dell'uso)
// ------------------------------------------------------------

interface RawMatch {
  date?: unknown;
  team1?: unknown;
  team2?: unknown;
  score?: { ft?: unknown } | null;
}

// ------------------------------------------------------------
// Dati calcolati
// ------------------------------------------------------------

export interface OpenFootballMatchResult {
  date: string;
  opponent: string;
  home: boolean;
  goalsFor: number;
  goalsAgainst: number;
  result: "W" | "D" | "L";
}

export interface OpenFootballTeamStats {
  /** Nome canonico OpenFootball (es. "AC Milan"). */
  team: string;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  points: number;
  /** Posizione in classifica (1 = prima). */
  rank: number;
  avgGoalsFor: number;
  avgGoalsAgainst: number;
  /** Esito di tutte le partite giocate, dalla più vecchia (es. "WWDLW"). */
  seasonForm: string;
  /** Esito delle ultime 5 partite giocate in casa / in trasferta. */
  homeForm: string;
  awayForm: string;
  /** Le 5 partite giocate più recenti, dalla più vecchia alla più recente. */
  last5: OpenFootballMatchResult[];
  /** Percentuali 0..1 su TUTTE le partite giocate della squadra. */
  over15: number;
  over25: number;
  under45: number;
  btts: number;
}

export interface OpenFootballLeague {
  league: string;
  sourceUrl: string;
  fetchedAt: number;
  /** Partite con risultato finale presenti nel dataset. */
  playedMatches: number;
  /** Statistiche per nome canonico. */
  teams: Map<string, OpenFootballTeamStats>;
  /** Classifica calcolata dai risultati giocati. */
  standings: OpenFootballTeamStats[];
}

// ------------------------------------------------------------
// Lettura e validazione del dataset
// ------------------------------------------------------------

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asScorePair(value: unknown): [number, number] | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  const [home, away] = value;
  if (typeof home !== "number" || typeof away !== "number") return null;
  if (!Number.isFinite(home) || !Number.isFinite(away)) return null;
  return [home, away];
}

interface PlayedMatch {
  date: string;
  team1: string;
  team2: string;
  ft: [number, number];
}

/**
 * Estrae le sole partite con risultato finale. Nel dataset le partite non
 * ancora giocate OMETTONO del tutto la chiave `score`: vengono ignorate.
 */
function extractPlayedMatches(raw: unknown): PlayedMatch[] {
  const matches = (raw as { matches?: unknown } | null)?.matches;
  if (!Array.isArray(matches)) {
    throw new OpenFootballError("Formato dataset inatteso: manca l'array `matches`.");
  }

  const played: PlayedMatch[] = [];
  for (const item of matches as RawMatch[]) {
    const team1 = asString(item?.team1);
    const team2 = asString(item?.team2);
    const date = asString(item?.date);
    const ft = asScorePair(item?.score?.ft);
    if (!team1 || !team2 || !date || !ft) continue;
    played.push({ date, team1, team2, ft });
  }

  played.sort((a, b) => a.date.localeCompare(b.date));
  return played;
}

// ------------------------------------------------------------
// Aggregazione locale
// ------------------------------------------------------------

interface Accumulator {
  team: string;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  over15: number;
  over25: number;
  under45: number;
  btts: number;
  matches: {
    date: string;
    opponent: string;
    home: boolean;
    goalsFor: number;
    goalsAgainst: number;
  }[];
}

function outcomeOf(goalsFor: number, goalsAgainst: number): "W" | "D" | "L" {
  if (goalsFor > goalsAgainst) return "W";
  if (goalsFor === goalsAgainst) return "D";
  return "L";
}

function formString(results: { goalsFor: number; goalsAgainst: number }[]): string {
  return results.map((r) => outcomeOf(r.goalsFor, r.goalsAgainst)).join("");
}

function accumulate(played: PlayedMatch[]): Map<string, Accumulator> {
  const byTeam = new Map<string, Accumulator>();

  const get = (team: string): Accumulator => {
    let acc = byTeam.get(team);
    if (!acc) {
      acc = {
        team,
        played: 0,
        wins: 0,
        draws: 0,
        losses: 0,
        goalsFor: 0,
        goalsAgainst: 0,
        over15: 0,
        over25: 0,
        under45: 0,
        btts: 0,
        matches: [],
      };
      byTeam.set(team, acc);
    }
    return acc;
  };

  for (const match of played) {
    const totalGoals = match.ft[0] + match.ft[1];
    const bothScored = match.ft[0] > 0 && match.ft[1] > 0;

    const sides = [
      { team: match.team1, opponent: match.team2, home: true, gf: match.ft[0], ga: match.ft[1] },
      { team: match.team2, opponent: match.team1, home: false, gf: match.ft[1], ga: match.ft[0] },
    ];

    for (const side of sides) {
      const acc = get(side.team);
      acc.played += 1;
      acc.goalsFor += side.gf;
      acc.goalsAgainst += side.ga;
      if (side.gf > side.ga) acc.wins += 1;
      else if (side.gf === side.ga) acc.draws += 1;
      else acc.losses += 1;

      if (totalGoals > 1.5) acc.over15 += 1;
      if (totalGoals > 2.5) acc.over25 += 1;
      if (totalGoals < 4.5) acc.under45 += 1;
      if (bothScored) acc.btts += 1;

      acc.matches.push({
        date: match.date,
        opponent: side.opponent,
        home: side.home,
        goalsFor: side.gf,
        goalsAgainst: side.ga,
      });
    }
  }

  return byTeam;
}

function toTeamStats(acc: Accumulator): OpenFootballTeamStats {
  const played = acc.played;
  const ratio = (count: number) => (played > 0 ? count / played : 0);

  // `acc.matches` è già in ordine cronologico (le partite sono ordinate per data).
  const homeMatches = acc.matches.filter((m) => m.home).slice(-5);
  const awayMatches = acc.matches.filter((m) => !m.home).slice(-5);

  return {
    team: acc.team,
    played,
    wins: acc.wins,
    draws: acc.draws,
    losses: acc.losses,
    goalsFor: acc.goalsFor,
    goalsAgainst: acc.goalsAgainst,
    goalDifference: acc.goalsFor - acc.goalsAgainst,
    points: acc.wins * 3 + acc.draws,
    rank: 0, // assegnato dopo l'ordinamento della classifica
    avgGoalsFor: played > 0 ? acc.goalsFor / played : 0,
    avgGoalsAgainst: played > 0 ? acc.goalsAgainst / played : 0,
    seasonForm: formString(acc.matches),
    homeForm: formString(homeMatches),
    awayForm: formString(awayMatches),
    last5: acc.matches.slice(-5).map((m) => ({
      date: m.date,
      opponent: m.opponent,
      home: m.home,
      goalsFor: m.goalsFor,
      goalsAgainst: m.goalsAgainst,
      result: outcomeOf(m.goalsFor, m.goalsAgainst),
    })),
    over15: ratio(acc.over15),
    over25: ratio(acc.over25),
    under45: ratio(acc.under45),
    btts: ratio(acc.btts),
  };
}

/** Costruisce il modello della lega a partire dal JSON grezzo. */
export function buildLeagueFromJson(raw: unknown, fetchedAt = Date.now()): OpenFootballLeague {
  const played = extractPlayedMatches(raw);
  const byTeam = accumulate(played);

  const standings = [...byTeam.values()]
    .map(toTeamStats)
    .sort(
      (a, b) =>
        b.points - a.points ||
        b.goalDifference - a.goalDifference ||
        b.goalsFor - a.goalsFor ||
        a.team.localeCompare(b.team)
    );

  standings.forEach((team, index) => {
    team.rank = index + 1;
  });

  return {
    league: asString((raw as { name?: unknown } | null)?.name) ?? "OpenFootball",
    sourceUrl: OPENFOOTBALL_SERIE_A_2026_27_URL,
    fetchedAt,
    playedMatches: played.length,
    teams: new Map(standings.map((team) => [team.team, team])),
    standings,
  };
}

// ------------------------------------------------------------
// Download con cache in memoria (una sola fetch per esecuzione)
// ------------------------------------------------------------

let cachedLeague: OpenFootballLeague | null = null;
let inFlight: Promise<OpenFootballLeague> | null = null;

/** True se la cache in memoria è ancora valida. */
export function isOpenFootballCacheFresh(now = Date.now()): boolean {
  return (
    cachedLeague !== null &&
    now - cachedLeague.fetchedAt < OPENFOOTBALL_CACHE_TTL_MS
  );
}

/** Solo per i test: azzera la cache. */
export function clearOpenFootballCache(): void {
  cachedLeague = null;
  inFlight = null;
}

/**
 * Carica il dataset della Serie A 2026/27.
 *
 * - restituisce la cache in memoria se ancora fresca (nessuna richiesta HTTP);
 * - altrimenti effettua UNA sola richiesta HTTP, condivisa fra chiamate
 *   concorrenti (dedup tramite la promise in volo);
 * - lancia `OpenFootballError` in caso di errore: il chiamante decide come
 *   degradare (le partite restano in attesa).
 */
export async function loadSerieA2026_27(): Promise<OpenFootballLeague> {
  if (isOpenFootballCacheFresh()) return cachedLeague as OpenFootballLeague;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      let response: Response;
      try {
        response = await fetch(OPENFOOTBALL_SERIE_A_2026_27_URL, { cache: "no-store" });
      } catch (err) {
        throw new OpenFootballError(
          `Impossibile contattare OpenFootball: ${
            err instanceof Error ? err.message : "errore di rete"
          }`
        );
      }

      if (!response.ok) {
        throw new OpenFootballError(
          `OpenFootball ha risposto con HTTP ${response.status}.`
        );
      }

      let raw: unknown;
      try {
        raw = await response.json();
      } catch {
        throw new OpenFootballError(
          "Risposta di OpenFootball non leggibile come JSON."
        );
      }

      const league = buildLeagueFromJson(raw);
      cachedLeague = league;
      return league;
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

// ------------------------------------------------------------
// Risoluzione dei nomi squadra
//
// OpenFootball usa i nomi legali estesi ("FC Internazionale Milano"),
// API-Football quelli brevi ("Inter"). La risoluzione avviene in due stadi:
//   1. normalizzazione (minuscole, accenti, token societari, anni);
//   2. alias espliciti per i pochi casi che la normalizzazione non copre.
// La risoluzione è limitata al set chiuso delle squadre presenti nel dataset:
// un nome sconosciuto NON viene mai associato a una squadra a caso.
// ------------------------------------------------------------

/** Token che non identificano la squadra (forme societarie e anni di fondazione). */
const LEGAL_TOKENS = new Set([
  "ac", "as", "ss", "ssc", "us", "fc", "cfc", "bc", "acf", "sc",
  "calcio", "srl", "spa",
  "1893", "1899", "1907", "1908", "1909", "1913",
]);

/** Alias espliciti: chiave = variante, valore = nome canonico OpenFootball. */
const TEAM_ALIASES: Record<string, string> = {
  inter: "FC Internazionale Milano",
  internazionale: "FC Internazionale Milano",
  "inter milan": "FC Internazionale Milano",
};

/** Normalizza un nome squadra per il confronto. */
export function normalizeTeamName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 0 && !LEGAL_TOKENS.has(token))
    .join(" ")
    .trim();
}

const indexCache = new WeakMap<OpenFootballLeague, Map<string, string>>();

/** Indice normalizzato -> nome canonico. `""` segnala un'ambiguità. */
function getTeamIndex(league: OpenFootballLeague): Map<string, string> {
  const cached = indexCache.get(league);
  if (cached) return cached;

  const index = new Map<string, string>();
  const add = (key: string, canonical: string) => {
    if (!key) return;
    const existing = index.get(key);
    if (existing && existing !== canonical) {
      index.set(key, ""); // due squadre diverse con la stessa chiave: ambiguo
      return;
    }
    index.set(key, canonical);
  };

  for (const canonical of league.teams.keys()) {
    add(normalizeTeamName(canonical), canonical);
  }
  for (const [alias, canonical] of Object.entries(TEAM_ALIASES)) {
    if (league.teams.has(canonical)) add(normalizeTeamName(alias), canonical);
  }

  indexCache.set(league, index);
  return index;
}

/**
 * Risolve un nome squadra arbitrario nel nome canonico OpenFootball.
 * Restituisce `null` se il nome non è riconosciuto o è ambiguo: in quel caso
 * la partita deve restare in attesa (nessun dato inventato).
 */
export function resolveOpenFootballTeam(
  name: string,
  league: OpenFootballLeague
): string | null {
  if (!name) return null;
  const key = normalizeTeamName(name);
  if (!key) return null;
  const resolved = getTeamIndex(league).get(key);
  return resolved ? resolved : null;
}
