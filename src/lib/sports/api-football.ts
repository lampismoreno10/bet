// ============================================================
// Client API-Football (api-sports.io) — SOLO SERVER-SIDE.
//
// ⚠️ Questo modulo NON deve essere importato da Client Component:
// usa la chiave `SPORTS_API_KEY` (senza prefisso NEXT_PUBLIC_), che
// deve restare esclusivamente sul server.
// ============================================================

import { isTrackedLeague } from "@/lib/sports/leagues";

export const API_BASE_URL = "https://v3.football.api-sports.io";

export type SportsApiErrorKind =
  | "missing_key"
  | "quota_exceeded"
  | "unauthorized"
  | "http"
  | "network"
  | "unknown";

export class SportsApiError extends Error {
  kind: SportsApiErrorKind;
  httpStatus?: number;
  quota: ApiQuotaMeta;

  constructor(
    message: string,
    kind: SportsApiErrorKind,
    httpStatus?: number,
    quota: ApiQuotaMeta = { requestsLimit: null, requestsRemaining: null }
  ) {
    super(message);
    this.name = "SportsApiError";
    this.kind = kind;
    this.httpStatus = httpStatus;
    this.quota = quota;
  }
}

export interface ApiFootballFixture {
  fixture: {
    id: number;
    date: string;
    status: { short: string; long: string; elapsed: number | null };
  };
  league: { id: number; name: string; country: string; season: number };
  teams: {
    home: { id: number; name: string };
    away: { id: number; name: string };
  };
  goals?: { home: number | null; away: number | null };
}

export interface ApiQuotaMeta {
  requestsLimit: number | null;
  requestsRemaining: number | null;
}

export interface FixturesResult {
  fixtures: ApiFootballFixture[];
  /** Tutte le partite restituite dall'API, prima del filtro sui campionati. */
  totalReturned: number;
  /** Numero di pagine dichiarate dall'API (>1 = risultato parziale). */
  pagesTotal: number;
  /** Campionati distinti presenti nella risposta (utile per la diagnostica). */
  leaguesFound: { id: number; name: string }[];
  quota: ApiQuotaMeta;
}

export function isSportsApiConfigured(): boolean {
  return Boolean(process.env.SPORTS_API_KEY);
}

function toNumberOrNull(value: unknown): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Estrae i messaggi d'errore dal campo `errors` (array o oggetto). */
function extractApiErrors(errors: unknown): string[] {
  if (!errors) return [];
  if (Array.isArray(errors)) {
    return errors.filter(Boolean).map((e) => String(e));
  }
  if (typeof errors === "object") {
    return Object.entries(errors as Record<string, unknown>)
      .filter(([, v]) => Boolean(v))
      .map(([k, v]) => `${k}: ${String(v)}`);
  }
  return [String(errors)];
}

/** Classifica l'errore restituito nel corpo della risposta. */
function classifyApiErrors(errors: unknown): SportsApiError | null {
  if (!errors) return null;

  const keys =
    !Array.isArray(errors) && typeof errors === "object"
      ? Object.keys(errors as Record<string, unknown>)
      : [];

  const messages = extractApiErrors(errors);
  if (messages.length === 0) return null;
  const text = messages.join(" ");
  const lower = text.toLowerCase();

  if (keys.includes("token")) {
    return new SportsApiError(
      `Chiave API non valida o non autorizzata: ${text}`,
      "unauthorized"
    );
  }

  // La quota esaurita si riconosce dal testo (rate limit), non dalla sola
  // chiave "requests": la stessa chiave è usata anche per altri errori
  // (es. data fuori range sul piano Free).
  if (/rate limit|too many requests|requests\/day|quota|limit reached/.test(lower)) {
    return new SportsApiError(`Quota API esaurita: ${text}`, "quota_exceeded");
  }

  return new SportsApiError(`Errore API-Football: ${text}`, "unknown");
}

interface ApiResponse {
  payload: {
    response?: unknown;
    errors?: unknown;
    paging?: { current?: number; total?: number };
  };
  quota: ApiQuotaMeta;
}

/** Esegue una GET verso API-Football e restituisce payload + quota. */
async function apiGet(
  path: string,
  params: Record<string, string>
): Promise<ApiResponse> {
  const apiKey = process.env.SPORTS_API_KEY;
  if (!apiKey) {
    throw new SportsApiError(
      "SPORTS_API_KEY non configurata sul server.",
      "missing_key"
    );
  }

  const url = new URL(path, API_BASE_URL);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      headers: { "x-apisports-key": apiKey },
      cache: "no-store",
    });
  } catch (err) {
    throw new SportsApiError(
      `Impossibile contattare API-Football: ${
        err instanceof Error ? err.message : "errore di rete"
      }`,
      "network"
    );
  }

  const quota: ApiQuotaMeta = {
    requestsLimit: toNumberOrNull(
      response.headers.get("x-ratelimit-requests-limit")
    ),
    requestsRemaining: toNumberOrNull(
      response.headers.get("x-ratelimit-requests-remaining")
    ),
  };

  if (response.status === 429) {
    throw new SportsApiError(
      "Quota API esaurita (HTTP 429). Riprova domani o aumenta il piano.",
      "quota_exceeded",
      429,
      quota
    );
  }

  if (!response.ok) {
    throw new SportsApiError(
      `API-Football ha risposto con HTTP ${response.status}.`,
      "http",
      response.status,
      quota
    );
  }

  let payload: ApiResponse["payload"];
  try {
    payload = (await response.json()) as ApiResponse["payload"];
  } catch {
    throw new SportsApiError(
      "Risposta di API-Football non leggibile.",
      "unknown",
      response.status,
      quota
    );
  }

  const apiError = classifyApiErrors(payload.errors);
  if (apiError) {
    apiError.httpStatus = response.status;
    apiError.quota = quota;
    throw apiError;
  }

  return { payload, quota };
}

/**
 * Recupera le partite di una data (formato YYYY-MM-DD).
 * Consuma UNA richiesta API.
 */
export async function fetchFixturesByDate(date: string): Promise<FixturesResult> {
  const { payload, quota } = await apiGet("/fixtures", {
    date,
    timezone: "Europe/Rome",
  });

  const raw = Array.isArray(payload.response) ? payload.response : [];
  const fixtures = raw as ApiFootballFixture[];
  const filtered = fixtures.filter((f) => isTrackedLeague(f.league?.id));

  const seen = new Map<number, string>();
  for (const f of fixtures) {
    if (f.league?.id != null && !seen.has(f.league.id)) {
      seen.set(f.league.id, f.league.name ?? `ID ${f.league.id}`);
    }
  }
  const leaguesFound = [...seen.entries()].map(([id, name]) => ({ id, name }));

  return {
    fixtures: filtered,
    totalReturned: fixtures.length,
    pagesTotal: payload.paging?.total ?? 1,
    leaguesFound,
    quota,
  };
}

/** Esito della sincronizzazione di una singola data. */
export interface DateFetchOutcome {
  date: string;
  ok: boolean;
  fixtures: ApiFootballFixture[];
  totalReturned: number;
  pagesTotal: number;
  leaguesFound: { id: number; name: string }[];
  quota: ApiQuotaMeta;
  errorMessage: string | null;
  errorKind: SportsApiErrorKind | null;
}

export interface MultiDateFixtures {
  dates: DateFetchOutcome[];
  fixtures: ApiFootballFixture[];
  leaguesFound: { id: number; name: string }[];
  pagesTotal: number;
  requestsUsed: number;
  quota: ApiQuotaMeta;
}

/**
 * Recupera le partite di più date, UNA richiesta per data.
 *
 * RESILIENTE: se una singola data fallisce (es. fuori dal range consentito
 * dal piano Free), NON interrompe il resto: prosegue con le date valide e
 * riporta per ogni data l'esito e il motivo. Non esegue retry.
 */
export async function fetchFixturesByDates(
  dates: string[]
): Promise<MultiDateFixtures> {
  const outcomes: DateFetchOutcome[] = [];
  let requestsUsed = 0;
  let quota: ApiQuotaMeta = { requestsLimit: null, requestsRemaining: null };

  for (const date of dates) {
    try {
      const r = await fetchFixturesByDate(date);
      requestsUsed += 1;
      quota = r.quota;
      outcomes.push({
        date,
        ok: true,
        fixtures: r.fixtures,
        totalReturned: r.totalReturned,
        pagesTotal: r.pagesTotal,
        leaguesFound: r.leaguesFound,
        quota: r.quota,
        errorMessage: null,
        errorKind: null,
      });
    } catch (err) {
      // La chiamata è stata comunque effettuata (tranne missing_key, già
      // gestito a monte). Non retry: registra e prosegui.
      requestsUsed += 1;
      const q =
        err instanceof SportsApiError
          ? err.quota
          : { requestsLimit: null, requestsRemaining: null };
      if (q.requestsLimit != null || q.requestsRemaining != null) quota = q;

      outcomes.push({
        date,
        ok: false,
        fixtures: [],
        totalReturned: 0,
        pagesTotal: 1,
        leaguesFound: [],
        quota: q,
        errorMessage: err instanceof Error ? err.message : "errore sconosciuto",
        errorKind: err instanceof SportsApiError ? err.kind : "unknown",
      });
    }
  }

  // Dedup su fixture.id (una partita non deve comparire due volte).
  const byId = new Map<number, ApiFootballFixture>();
  const leagueMap = new Map<number, string>();
  let pagesTotal = 1;
  for (const o of outcomes) {
    if (!o.ok) continue;
    for (const f of o.fixtures) byId.set(f.fixture.id, f);
    for (const l of o.leaguesFound) leagueMap.set(l.id, l.name);
    pagesTotal = Math.max(pagesTotal, o.pagesTotal);
  }

  return {
    dates: outcomes,
    fixtures: [...byId.values()],
    leaguesFound: [...leagueMap.entries()].map(([id, name]) => ({ id, name })),
    pagesTotal,
    requestsUsed,
    quota,
  };
}

/**
 * Recupera una lista di partite per id (fixture id), raggruppandole in
 * un'unica richiesta. Usato da "Aggiorna risultati".
 */
export async function fetchFixturesByIds(ids: number[]): Promise<ApiFootballFixture[]> {
  if (ids.length === 0) return [];
  const { payload } = await apiGet("/fixtures", {
    ids: ids.join("-"),
  });
  const raw = Array.isArray(payload.response) ? payload.response : [];
  return raw as ApiFootballFixture[];
}

// ------------------------------------------------------------
// Deep data (per l'analisi). Ogni funzione è "best effort": il chiamante
// le avvolge in try/catch e, in caso di errore, tratta il dato come
// non disponibile invece di far fallire l'intera pipeline.
// ------------------------------------------------------------

export interface TeamStatistics {
  form: string | null;
  goalsFor: number | null;
  goalsAgainst: number | null;
  wins: number | null;
  draws: number | null;
  losses: number | null;
}

export interface HeadToHeadMatch {
  date: string;
  homeTeam: string;
  awayTeam: string;
  homeGoals: number | null;
  awayGoals: number | null;
}

export interface StandingRow {
  rank: number;
  team: string;
  points: number;
}

export interface InjuryInfo {
  team: string;
  player: string;
  type: string;
  reason: string;
}

export interface FixtureOdds {
  bookmaker: string;
  markets: { name: string; values: { value: string; odd: number }[] }[];
}

export async function fetchTeamStatistics(
  teamId: number,
  leagueId: number,
  season: number
): Promise<TeamStatistics | null> {
  const { payload } = await apiGet("/teams/statistics", {
    team: String(teamId),
    league: String(leagueId),
    season: String(season),
  });
  const r = (payload.response as Record<string, unknown> | null) ?? null;
  if (!r) return null;

  return {
    form: typeof r.form === "string" ? r.form : null,
    goalsFor: toNumberOrNull((r.goals as any)?.for?.total?.total),
    goalsAgainst: toNumberOrNull((r.goals as any)?.against?.total?.total),
    wins: toNumberOrNull((r.fixtures as any)?.wins?.total),
    draws: toNumberOrNull((r.fixtures as any)?.draws?.total),
    losses: toNumberOrNull((r.fixtures as any)?.loses?.total),
  };
}

export async function fetchHeadToHead(
  homeTeamId: number,
  awayTeamId: number
): Promise<HeadToHeadMatch[] | null> {
  const { payload } = await apiGet("/fixtures/headtohead", {
    h2h: `${homeTeamId}-${awayTeamId}`,
  });
  const arr = Array.isArray(payload.response) ? payload.response : [];
  if (arr.length === 0) return null;
  return arr.slice(0, 10).map((f: any) => ({
    date: f?.fixture?.date ?? "",
    homeTeam: f?.teams?.home?.name ?? "?",
    awayTeam: f?.teams?.away?.name ?? "?",
    homeGoals: toNumberOrNull(f?.goals?.home),
    awayGoals: toNumberOrNull(f?.goals?.away),
  }));
}

export async function fetchStandings(
  leagueId: number,
  season: number
): Promise<StandingRow[] | null> {
  const { payload } = await apiGet("/standings", {
    league: String(leagueId),
    season: String(season),
  });
  const first = (Array.isArray(payload.response) ? payload.response : [])[0] as any;
  const groups = first?.league?.standings;
  if (!Array.isArray(groups)) return null;

  const rows: StandingRow[] = [];
  for (const g of groups) {
    if (!Array.isArray(g)) continue;
    for (const r of g) {
      rows.push({
        rank: Number(r?.rank ?? 0),
        team: r?.team?.name ?? "?",
        points: Number(r?.points ?? 0),
      });
    }
  }
  return rows.length > 0 ? rows : null;
}

export async function fetchInjuries(teamId: number): Promise<InjuryInfo[] | null> {
  const { payload } = await apiGet("/injuries", { team: String(teamId) });
  const arr = Array.isArray(payload.response) ? payload.response : [];
  if (arr.length === 0) return null;
  return arr.slice(0, 20).map((i: any) => ({
    team: i?.team?.name ?? "?",
    player: i?.player?.name ?? "?",
    type: i?.player?.type ?? "?",
    reason: i?.player?.reason ?? "",
  }));
}

export async function fetchFixtureOdds(
  fixtureId: number
): Promise<FixtureOdds | null> {
  // L'endpoint /odds è spesso riservato ai piani a pagamento: se non
  // disponibile restituisce errore/403, gestito dal chiamante.
  const { payload } = await apiGet("/odds", { fixture: String(fixtureId) });
  const arr = Array.isArray(payload.response) ? payload.response : [];
  const bookmaker = (arr[0] as any)?.bookmakers?.[0];
  if (!bookmaker) return null;

  return {
    bookmaker: bookmaker.name ?? "?",
    markets: (bookmaker.bets ?? []).slice(0, 5).map((b: any) => ({
      name: b?.name ?? "?",
      values: (b?.values ?? []).slice(0, 3).map((v: any) => ({
        value: v?.value ?? "?",
        odd: Number(v?.odd ?? 0),
      })),
    })),
  };
}
