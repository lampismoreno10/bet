// ============================================================
// Client API-Football (api-sports.io) — SOLO SERVER-SIDE.
//
// ⚠️ Questo modulo NON deve essere importato da Client Component:
// usa la chiave `SPORTS_API_KEY` (senza prefisso NEXT_PUBLIC_).
//
// Uso previsto, e nient'altro:
//   1. sync delle partite      GET /fixtures?date=
//   2. aggiornamento risultati GET /fixtures?ids=
//   3. quote reali             GET /odds?fixture=        (1 per partita)
//   4. contesto di fallback    GET /predictions?fixture=  (1 per partita,
//      SOLO per le competizioni non coperte da OpenFootball)
//
// Ogni chiamata passa dal throttle centralizzato (piano Free: 10/min):
// sequenziale, con intervallo minimo e rispetto della riserva giornaliera.
//
// Le vecchie chiamate di arricchimento (teams/statistics, injuries,
// head-to-head, standings) sono state RIMOSSE: lo schema da 49 richieste
// per 8 partite non esiste più.
// ============================================================

import { isTrackedLeague } from "@/lib/sports/leagues";
import { extractQuotesFromBets, type MarketCode } from "@/lib/sports/markets";
import { sportsThrottle } from "@/lib/sports/throttle";

export const API_BASE_URL = "https://v3.football.api-sports.io";

export type SportsApiErrorKind =
  | "missing_key"
  | "quota_exceeded"
  | "unauthorized"
  | "http"
  | "network"
  | "unknown";

export interface ApiQuotaMeta {
  requestsLimit: number | null;
  requestsRemaining: number | null;
}

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

function asTrimmedString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
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

/**
 * Esegue una GET verso API-Football passando dal throttle centralizzato.
 * NB: chiamate SEQUENZIALI, mai in parallelo.
 */
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

  // Throttle: garantisce l'intervallo minimo fra due richieste API-Football.
  await sportsThrottle.waitTurn();

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

  // Quota: aggiorna lo stato centralizzato e il valore di ritorno.
  sportsThrottle.recordQuota(response.headers);
  const centralQuota = sportsThrottle.getQuota();
  const quota: ApiQuotaMeta = {
    requestsLimit: centralQuota.limit,
    requestsRemaining: centralQuota.remaining,
  };

  if (response.status === 429) {
    sportsThrottle.markRateLimited();
    throw new SportsApiError(
      "Quota API esaurita (HTTP 429). Parte API interrotta.",
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
    if (apiError.kind === "quota_exceeded") sportsThrottle.markRateLimited();
    throw apiError;
  }

  return { payload, quota };
}

// ------------------------------------------------------------
// Fixtures (sync e aggiornamento risultati) — INVARIATI
// ------------------------------------------------------------

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
 * Recupera le partite di più date, UNA richiesta per data, in sequenza.
 * RESILIENTE: se una singola data fallisce non interrompe il resto.
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
export async function fetchFixturesByIds(
  ids: number[]
): Promise<ApiFootballFixture[]> {
  if (ids.length === 0) return [];
  const { payload } = await apiGet("/fixtures", {
    ids: ids.join("-"),
  });
  const raw = Array.isArray(payload.response) ? payload.response : [];
  return raw as ApiFootballFixture[];
}

// ------------------------------------------------------------
// Quote reali — UNA richiesta per partita candidata
// ------------------------------------------------------------

export interface OddsQuote {
  market: MarketCode;
  label: string;
  /** Valore originale restituito dall'API (per diagnostica). */
  apiValue: string;
  odd: number;
}

export interface FixtureOdds {
  /** Bookmaker scelto (Bet365 se disponibile, altrimenti deterministico). */
  bookmaker: string;
  bookmakerId: number | null;
  quotes: OddsQuote[];
  byMarket: Partial<Record<MarketCode, OddsQuote>>;
}

const PREFERRED_BOOKMAKER = "bet365";

interface RawBookmaker {
  id?: unknown;
  name?: unknown;
  bets?: { id?: unknown; name?: unknown; values?: unknown }[];
}

/**
 * Sceglie il bookmaker: Bet365 se presente, altrimenti il primo per id
 * crescente (scelta DETERMINISTICA, non casuale).
 */
function pickBookmaker(bookmakers: RawBookmaker[]): RawBookmaker | null {
  if (bookmakers.length === 0) return null;

  const preferred = bookmakers.find((b) =>
    String(b.name ?? "")
      .toLowerCase()
      .includes(PREFERRED_BOOKMAKER)
  );
  if (preferred) return preferred;

  return [...bookmakers].sort((a, b) => {
    const idA = toNumberOrNull(a.id) ?? Number.MAX_SAFE_INTEGER;
    const idB = toNumberOrNull(b.id) ?? Number.MAX_SAFE_INTEGER;
    if (idA !== idB) return idA - idB;
    return String(a.name ?? "").localeCompare(String(b.name ?? ""));
  })[0];
}

/**
 * Recupera le quote PRE-MATCH di una partita ed estrae SOLO i mercati
 * ammessi e automaticamente liquidabili. UNA sola richiesta per partita.
 *
 * Restituisce null se nessun mercato ammesso è disponibile: in quel caso
 * la partita resta "da valutare" (mai quote inventate).
 */
export async function fetchFixtureOdds(
  fixtureId: number
): Promise<FixtureOdds | null> {
  const { payload } = await apiGet("/odds", { fixture: String(fixtureId) });
  const raw = Array.isArray(payload.response) ? payload.response : [];

  const bookmakers: RawBookmaker[] = [];
  for (const item of raw as { bookmakers?: RawBookmaker[] }[]) {
    if (Array.isArray(item?.bookmakers)) bookmakers.push(...item.bookmakers);
  }

  const bookmaker = pickBookmaker(bookmakers);
  if (!bookmaker) return null;

  const byMarket = extractQuotesFromBets(bookmaker.bets) as Partial<
    Record<MarketCode, OddsQuote>
  >;
  const quotes = Object.values(byMarket) as OddsQuote[];
  if (quotes.length === 0) return null;

  return {
    bookmaker: asTrimmedString(bookmaker.name) ?? "Bookmaker",
    bookmakerId: toNumberOrNull(bookmaker.id),
    quotes,
    byMarket,
  };
}

// ------------------------------------------------------------
// Fallback leggero per competizioni non coperte da OpenFootball
// ------------------------------------------------------------

export interface FixturePrediction {
  winner: string | null;
  winOrDraw: boolean | null;
  underOver: string | null;
  advice: string | null;
  percentHome: string | null;
  percentDraw: string | null;
  percentAway: string | null;
  goalsHome: string | null;
  goalsAway: string | null;
}

/**
 * Recupera la previsione di API-Football per una partita.
 * UNA sola richiesta, usata SOLO come contesto di fallback: il prompt la
 * presenta esplicitamente come stima di terze parti, non come fatto certo.
 */
export async function fetchPrediction(
  fixtureId: number
): Promise<FixturePrediction | null> {
  const { payload } = await apiGet("/predictions", {
    fixture: String(fixtureId),
  });
  const first = (Array.isArray(payload.response) ? payload.response : [])[0] as
    | {
        predictions?: {
          winner?: { name?: unknown };
          win_or_draw?: unknown;
          under_over?: unknown;
          advice?: unknown;
          percent?: { home?: unknown; draw?: unknown; away?: unknown };
          goals?: { home?: unknown; away?: unknown };
        };
      }
    | undefined;

  const p = first?.predictions;
  if (!p) return null;

  const asText = (v: unknown) =>
    typeof v === "string" || typeof v === "number" ? String(v) : null;

  return {
    winner: asText(p.winner?.name),
    winOrDraw: typeof p.win_or_draw === "boolean" ? p.win_or_draw : null,
    underOver: asTrimmedString(p.under_over),
    advice: asTrimmedString(p.advice),
    percentHome: asText(p.percent?.home),
    percentDraw: asText(p.percent?.draw),
    percentAway: asText(p.percent?.away),
    goalsHome: asText(p.goals?.home),
    goalsAway: asText(p.goals?.away),
  };
}
