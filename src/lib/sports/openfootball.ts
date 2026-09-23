// ============================================================
// Fonte statistica PRIMARIA: OpenFootball / football.json
//
// ⚠️ Questo modulo NON effettua alcuna chiamata ad API-Football.
//
// Fonte: https://github.com/openfootball/football.json
// Licenza: CC0 / public domain. Nessuna API key. Nessuno scraping HTML.
//
// Tutte le statistiche sono calcolate LOCALMENTE dal JSON, usando solo le
// partite che hanno già un risultato finale (`score.ft`). Nessun dato viene
// inventato: se un'informazione non è nel dataset, non viene prodotta.
//
// I dataset sono file statici su raw.githubusercontent.com: ogni dataset
// viene scaricato UNA sola volta per esecuzione (cache in memoria per lega
// + dedup delle chiamate concorrenti), mai una volta per partita.
//
// ⚠️ Gli URL sotto sono stati VERIFICATI uno per uno. La Serie B 2026/27
// NON esiste nel repository (HTTP 404) e quindi non è configurata.
// ============================================================

/** Stagione coperta dai dataset configurati (2026/27). */
export const OPENFOOTBALL_SEASON = 2026;

export interface OpenFootballDataset {
  /** URL raw del dataset (verificato). */
  url: string;
  /** Etichetta leggibile della competizione. */
  label: string;
}

const FOOTBALL_JSON_BASE =
  "https://raw.githubusercontent.com/openfootball/football.json/master/2026-27";

/**
 * Configurazione CENTRALIZZATA: id lega API-Football -> dataset OpenFootball.
 *
 * Aggiungere una competizione qui la abilita automaticamente in tutta la
 * pipeline: nessuna logica duplicata per campionato.
 */
export const OPENFOOTBALL_DATASETS: Record<number, OpenFootballDataset> = {
  135: { url: `${FOOTBALL_JSON_BASE}/it.1.json`, label: "Serie A 2026/27" },
  39: { url: `${FOOTBALL_JSON_BASE}/en.1.json`, label: "Premier League 2026/27" },
  40: { url: `${FOOTBALL_JSON_BASE}/en.2.json`, label: "Championship 2026/27" },
  140: { url: `${FOOTBALL_JSON_BASE}/es.1.json`, label: "La Liga 2026/27" },
  78: { url: `${FOOTBALL_JSON_BASE}/de.1.json`, label: "Bundesliga 2026/27" },
  61: { url: `${FOOTBALL_JSON_BASE}/fr.1.json`, label: "Ligue 1 2026/27" },
};

/** True se esiste un dataset OpenFootball per questa lega e stagione. */
export function hasOpenFootballDataset(
  leagueId: number | null | undefined,
  season: number | null | undefined
): boolean {
  if (leagueId == null || !(leagueId in OPENFOOTBALL_DATASETS)) return false;
  return season == null || season === OPENFOOTBALL_SEASON;
}

/** Etichetta della competizione, se coperta da OpenFootball. */
export function openFootballLabel(leagueId: number | null | undefined): string | null {
  if (leagueId == null) return null;
  return OPENFOOTBALL_DATASETS[leagueId]?.label ?? null;
}

/** Durata della cache in memoria: evita di riscaricare lo stesso JSON. */
export const OPENFOOTBALL_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minuti

// ------------------------------------------------------------
// Vocabolario condiviso del contesto: prodotto da questo modulo,
// consumato dal costruttore del prompt. Le percentuali sono 0..1.
// ------------------------------------------------------------
export interface TeamStatistics {
  form: string | null;
  goalsFor: number | null;
  goalsAgainst: number | null;
  wins: number | null;
  draws: number | null;
  losses: number | null;
  played?: number | null;
  points?: number | null;
  rank?: number | null;
  goalDifference?: number | null;
  avgGoalsFor?: number | null;
  avgGoalsAgainst?: number | null;
  /** Forma nelle partite in casa / in trasferta (es. "WWDLW"). */
  homeForm?: string | null;
  awayForm?: string | null;
  over15?: number | null;
  over25?: number | null;
  under45?: number | null;
  btts?: number | null;
  /** Ultime 5 partite giocate, già formattate per il prompt. */
  last5?: string[] | null;
}

export interface StandingRow {
  rank: number;
  team: string;
  points: number;
  played?: number | null;
  goalDifference?: number | null;
}


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
  /** Id lega API-Football a cui questo dataset è associato. */
  leagueId: number;
  /** Etichetta della competizione (dalla configurazione centralizzata). */
  datasetLabel: string;
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
export function buildLeagueFromJson(
  raw: unknown,
  dataset: OpenFootballDataset,
  leagueId: number,
  fetchedAt = Date.now()
): OpenFootballLeague {
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
    league: asString((raw as { name?: unknown } | null)?.name) ?? dataset.label,
    leagueId,
    datasetLabel: dataset.label,
    sourceUrl: dataset.url,
    fetchedAt,
    playedMatches: played.length,
    teams: new Map(standings.map((team) => [team.team, team])),
    standings,
  };
}

// ------------------------------------------------------------
// Download con cache in memoria (una sola fetch per esecuzione)
// ------------------------------------------------------------

const cache = new Map<number, OpenFootballLeague>();
const inFlight = new Map<number, Promise<OpenFootballLeague>>();

/** True se il dataset di quella lega è in cache e ancora fresco. */
export function isOpenFootballCacheFresh(
  leagueId: number,
  now = Date.now()
): boolean {
  const cached = cache.get(leagueId);
  return cached != null && now - cached.fetchedAt < OPENFOOTBALL_CACHE_TTL_MS;
}

/** Solo per i test: azzera la cache. */
export function clearOpenFootballCache(): void {
  cache.clear();
  inFlight.clear();
}

/** Leghe attualmente in cache (diagnostica). */
export function cachedLeagueIds(): number[] {
  return [...cache.keys()];
}

/**
 * Carica il dataset OpenFootball di una lega.
 *
 * - restituisce la cache in memoria se ancora fresca (nessuna richiesta HTTP);
 * - altrimenti effettua UNA sola richiesta HTTP per dataset, condivisa fra
 *   chiamate concorrenti (dedup tramite la promise in volo);
 * - lancia `OpenFootballError` se la lega non è coperta o se il download
 *   fallisce: il chiamante decide come degradare (le partite restano in
 *   attesa, nessun dato inventato).
 */
export async function loadLeague(leagueId: number): Promise<OpenFootballLeague> {
  const dataset = OPENFOOTBALL_DATASETS[leagueId];
  if (!dataset) {
    throw new OpenFootballError(
      `Nessun dataset OpenFootball configurato per la lega ${leagueId}.`
    );
  }

  if (isOpenFootballCacheFresh(leagueId)) {
    return cache.get(leagueId) as OpenFootballLeague;
  }

  const pending = inFlight.get(leagueId);
  if (pending) return pending;

  const request = (async () => {
    try {
      let response: Response;
      try {
        response = await fetch(dataset.url, { cache: "no-store" });
      } catch (err) {
        throw new OpenFootballError(
          `Impossibile contattare OpenFootball: ${
            err instanceof Error ? err.message : "errore di rete"
          }`
        );
      }

      if (!response.ok) {
        throw new OpenFootballError(
          `OpenFootball ha risposto con HTTP ${response.status} per ${dataset.label}.`
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

      const league = buildLeagueFromJson(raw, dataset, leagueId);
      cache.set(leagueId, league);
      return league;
    } finally {
      inFlight.delete(leagueId);
    }
  })();

  inFlight.set(leagueId, request);
  return request;
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

/**
 * Token che NON identificano la squadra: forme societarie, suffissi e anni.
 * Rimuoverli è sicuro perché non distinguono due squadre della stessa
 * competizione. Restano invece INTATTI i token identitari (City, United,
 * Real, Atlético, Borussia, Sporting, Racing, ...).
 */
const LEGAL_TOKENS = new Set([
  // italiano
  "ac", "as", "ss", "ssc", "us", "fc", "cfc", "bc", "acf", "sc", "calcio",
  "srl", "spa",
  // inglese
  "afc",
  // spagnolo
  "ca", "cf", "rc", "rcd", "ud", "cd", "sd", "club", "de", "futbol",
  "balompie", "deportivo",
  // tedesco
  "sv", "vfb", "vfl", "tsg", "bsc", "fsv",
  // francese
  "aj", "es", "osc", "ogc", "sco",
]);

/**
 * Alias espliciti: chiave = variante normalizzata, valore = nome canonico
 * OpenFootball. Servono SOLO dove API-Football usa un nome più corto o
 * diverso da quello del dataset.
 *
 * L'alias è applicato solo se il nome canonico esiste nella lega caricata:
 * un alias di un'altra competizione viene ignorato, quindi non può
 * attribuire le statistiche alla squadra sbagliata.
 */
const TEAM_ALIASES: Record<string, string> = {
  // Serie A
  inter: "FC Internazionale Milano",
  internazionale: "FC Internazionale Milano",
  "inter milan": "FC Internazionale Milano",

  // Premier League
  brighton: "Brighton & Hove Albion FC",
  wolves: "Wolverhampton Wanderers FC",
  tottenham: "Tottenham Hotspur FC",
  spurs: "Tottenham Hotspur FC",
  newcastle: "Newcastle United FC",
  "west ham": "West Ham United FC",
  leeds: "Leeds United FC",
  ipswich: "Ipswich Town FC",
  coventry: "Coventry City FC",
  hull: "Hull City AFC",

  // Championship
  qpr: "Queens Park Rangers FC",
  "west brom": "West Bromwich Albion FC",
  "west bromwich": "West Bromwich Albion FC",
  stoke: "Stoke City FC",
  swansea: "Swansea City AFC",
  cardiff: "Cardiff City FC",
  birmingham: "Birmingham City FC",
  derby: "Derby County FC",
  norwich: "Norwich City FC",
  lincoln: "Lincoln City FC",
  bolton: "Bolton Wanderers FC",
  blackburn: "Blackburn Rovers FC",
  preston: "Preston North End FC",
  charlton: "Charlton Athletic FC",

  // La Liga
  espanyol: "RCD Espanyol de Barcelona",
  "rayo vallecano": "Rayo Vallecano de Madrid",
  "racing santander": "Real Racing Club de Santander",

  // Bundesliga
  cologne: "1. FC Köln",
  "bayern munich": "FC Bayern München",
  munich: "FC Bayern München",
  gladbach: "Borussia Mönchengladbach",
  "borussia monchengladbach": "Borussia Mönchengladbach",

  // Ligue 1
  marseille: "Olympique de Marseille",
  lyon: "Olympique Lyonnais",
  strasbourg: "RC Strasbourg Alsace",
  rennes: "Stade Rennais FC 1901",
  brest: "Stade Brestois 29",
  lens: "Racing Club de Lens",
  psg: "Paris Saint-Germain FC",
  "paris sg": "Paris Saint-Germain FC",
};

/**
 * Normalizza un nome squadra per il confronto: minuscole, accenti rimossi,
 * punteggiatura trasformata in spazi, token societari e anni eliminati.
 */
export function normalizeTeamName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter(
      (token) =>
        token.length > 0 &&
        !LEGAL_TOKENS.has(token) &&
        !/^\d+$/.test(token) // anni di fondazione e numeri societari ("1.", "04")
    )
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
