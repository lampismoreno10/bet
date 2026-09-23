// ============================================================
// Throttle centralizzato per API-Football.
//
// Piano Free: 100 richieste/giorno, 10 richieste/minuto.
//
// Regole applicate:
//   - chiamate SEQUENZIALI: mai Promise.all su API-Football;
//   - intervallo minimo fra due richieste (default ~6.8s => ~8.8 req/min);
//   - quota letta dagli header di risposta (limit / remaining);
//   - riserva giornaliera di sicurezza per sync e "Aggiorna risultati":
//     sotto quella soglia NON si avviano nuove analisi;
//   - su HTTP 429 si interrompe la parte API e si ritorna `partial`.
//
// Stato di modulo: dura quanto l'invocazione server, che è esattamente il
// perimetro in cui serve (una run = una sequenza di chiamate).
// ============================================================

export interface ApiQuota {
  limit: number | null;
  remaining: number | null;
}

/** Intervallo minimo fra due richieste API-Football (10/min => 6s teorici). */
export const API_MIN_INTERVAL_MS = 6800;

/** Quota giornaliera che NON va consumata: serve a sync e risultati. */
export const API_DAILY_RESERVE = 20;

function toNumberOrNull(value: string | null): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Legge la quota dagli header, accettando entrambe le convenzioni. */
export function readQuotaHeaders(headers: Headers): ApiQuota {
  return {
    limit:
      toNumberOrNull(headers.get("x-ratelimit-requests-limit")) ??
      toNumberOrNull(headers.get("X-RateLimit-Limit")),
    remaining:
      toNumberOrNull(headers.get("x-ratelimit-requests-remaining")) ??
      toNumberOrNull(headers.get("X-RateLimit-Remaining")),
  };
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class ApiThrottle {
  private readonly minIntervalMs: number;
  private readonly reserve: number;
  private readonly now: () => number;
  private lastRequestAt = 0;
  private quota: ApiQuota = { limit: null, remaining: null };
  private rateLimited = false;

  constructor(
    options: {
      minIntervalMs?: number;
      reserve?: number;
      now?: () => number;
    } = {}
  ) {
    this.minIntervalMs = options.minIntervalMs ?? API_MIN_INTERVAL_MS;
    this.reserve = options.reserve ?? API_DAILY_RESERVE;
    this.now = options.now ?? (() => Date.now());
  }

  /** Azzera lo stato (usato dai test e all'inizio di una run). */
  reset(): void {
    this.lastRequestAt = 0;
    this.quota = { limit: null, remaining: null };
    this.rateLimited = false;
  }

  getQuota(): ApiQuota {
    return { ...this.quota };
  }

  isRateLimited(): boolean {
    return this.rateLimited;
  }

  /** Registra un HTTP 429: da qui in poi `canSpend()` è false. */
  markRateLimited(): void {
    this.rateLimited = true;
  }

  /** Aggiorna la quota dagli header di una risposta. */
  recordQuota(headers: Headers): void {
    const parsed = readQuotaHeaders(headers);
    if (parsed.limit != null) this.quota.limit = parsed.limit;
    if (parsed.remaining != null) this.quota.remaining = parsed.remaining;
  }

  /**
   * Attende il turno: garantisce l'intervallo minimo fra due richieste.
   * Va chiamato PRIMA di ogni richiesta API-Football.
   */
  async waitTurn(): Promise<void> {
    const elapsed = this.now() - this.lastRequestAt;
    const wait = this.minIntervalMs - elapsed;
    if (wait > 0) await sleep(wait);
    this.lastRequestAt = this.now();
  }

  /**
   * True se si può spendere quota per `required` richieste senza intaccare
   * la riserva. Con quota sconosciuta (header assenti) si procede: meglio
   * rischiare un 429 gestito che bloccare tutto.
   */
  canSpend(required = 1): boolean {
    if (this.rateLimited) return false;
    if (this.quota.remaining == null) return true;
    return this.quota.remaining - required >= this.reserve;
  }

  /** Riserva configurata (per la UI/diagnostica). */
  getReserve(): number {
    return this.reserve;
  }
}

/** Istanza condivisa dalla pipeline server-side. */
export const sportsThrottle = new ApiThrottle();
