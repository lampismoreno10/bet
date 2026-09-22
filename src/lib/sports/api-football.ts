// ============================================================
// Client API-Football (api-sports.io) — SOLO SERVER-SIDE.
//
// ⚠️ Questo modulo NON deve essere importato da Client Component:
// usa la chiave `SPORTS_API_KEY` (senza prefisso NEXT_PUBLIC_), che
// deve restare esclusivamente sul server.
//
// Ottimizzazione richieste: l'endpoint /fixtures accetta il parametro
// `date`, che restituisce TUTTE le partite di quel giorno in una sola
// chiamata. Filtriamo poi i campionati di interesse in locale, così
// l'import costa 1 richiesta invece di 10 (una per campionato).
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

  constructor(message: string, kind: SportsApiErrorKind, httpStatus?: number) {
    super(message);
    this.name = "SportsApiError";
    this.kind = kind;
    this.httpStatus = httpStatus;
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

function toNumberOrNull(value: string | null): number | null {
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

  if (keys.includes("rateLimit") || keys.includes("requests")) {
    return new SportsApiError(
      `Quota API esaurita: ${text}`,
      "quota_exceeded"
    );
  }
  if (keys.includes("token")) {
    return new SportsApiError(
      `Chiave API non valida o non autorizzata: ${text}`,
      "unauthorized"
    );
  }
  return new SportsApiError(`Errore API-Football: ${text}`, "unknown");
}

/**
 * Recupera le partite di una data (formato YYYY-MM-DD).
 * Consuma UNA sola richiesta API.
 */
export async function fetchFixturesByDate(date: string): Promise<FixturesResult> {
  const apiKey = process.env.SPORTS_API_KEY;
  if (!apiKey) {
    throw new SportsApiError(
      "SPORTS_API_KEY non configurata sul server.",
      "missing_key"
    );
  }

  const url = new URL("/fixtures", API_BASE_URL);
  url.searchParams.set("date", date);
  url.searchParams.set("timezone", "Europe/Rome");

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
    requestsLimit: toNumberOrNull(response.headers.get("x-ratelimit-requests-limit")),
    requestsRemaining: toNumberOrNull(
      response.headers.get("x-ratelimit-requests-remaining")
    ),
  };

  if (response.status === 429) {
    throw new SportsApiError(
      "Quota API esaurita (HTTP 429). Riprova domani o aumenta il piano.",
      "quota_exceeded",
      429
    );
  }

  if (!response.ok) {
    throw new SportsApiError(
      `API-Football ha risposto con HTTP ${response.status}.`,
      "http",
      response.status
    );
  }

  let payload: {
    response?: unknown;
    errors?: unknown;
    paging?: { current?: number; total?: number };
  };
  try {
    payload = (await response.json()) as typeof payload;
  } catch {
    throw new SportsApiError("Risposta di API-Football non leggibile.", "unknown");
  }

  // API-Football può restituire HTTP 200 con gli errori nel corpo.
  const apiError = classifyApiErrors(payload.errors);
  if (apiError) {
    apiError.httpStatus = response.status;
    throw apiError;
  }

  const raw = Array.isArray(payload.response) ? payload.response : [];
  const fixtures = raw as ApiFootballFixture[];
  const filtered = fixtures.filter((f) => isTrackedLeague(f.league?.id));

  // Campionati distinti presenti nella risposta (per capire cosa è arrivato).
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
