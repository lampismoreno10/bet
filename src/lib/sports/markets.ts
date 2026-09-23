// ============================================================
// Mercati supportati: vocabolario condiviso tra
//   - la pipeline di analisi (quote reali + validazione della scelta del modello)
//   - il settlement automatico basato sul SOLO risultato finale
//
// Modulo PURO: nessun import a runtime, nessuna chiamata esterna.
//
// Sono ammessi SOLO mercati automaticamente liquidabili con il risultato
// finale (1X2 in doppia chance, Over/Under, BTTS). Corner, cartellini e
// Multigol sono VOLUTAMENTE esclusi: richiedono statistiche aggiuntive o
// non sono rappresentabili senza ambiguità con le quote disponibili.
// ============================================================

export type MarketCode =
  | "1X"
  | "X2"
  | "12"
  | "OVER_1_5"
  | "UNDER_1_5"
  | "OVER_2_5"
  | "UNDER_2_5"
  | "OVER_4_5"
  | "UNDER_4_5"
  | "BTTS_YES"
  | "BTTS_NO";

export type MarketOutcome = "won" | "lost";

export interface MarketSpec {
  code: MarketCode;
  /** Etichetta leggibile (prompt e UI). */
  label: string;
  /** Mercato atteso nella risposta del modello. */
  modelMarket: string;
  /** Selezione attesa nella risposta del modello. */
  modelSelection: string;
  /** Nomi del mercato in API-Football /odds (confronto normalizzato). */
  apiBetNames: string[];
  /** Valori accettati in quel mercato (confronto normalizzato). */
  apiValues: string[];
  /** Esito rispetto al risultato finale. */
  settle: (home: number, away: number) => MarketOutcome;
}

const total = (home: number, away: number) => home + away;

export const MARKETS: MarketSpec[] = [
  {
    code: "1X",
    label: "Doppia chance 1X (casa o pareggio)",
    modelMarket: "1X2",
    modelSelection: "1X",
    apiBetNames: ["Double Chance"],
    apiValues: ["Home/Draw", "1X"],
    settle: (home, away) => (home >= away ? "won" : "lost"),
  },
  {
    code: "X2",
    label: "Doppia chance X2 (pareggio o trasferta)",
    modelMarket: "1X2",
    modelSelection: "X2",
    apiBetNames: ["Double Chance"],
    apiValues: ["Draw/Away", "X2"],
    settle: (home, away) => (home <= away ? "won" : "lost"),
  },
  {
    code: "12",
    label: "Doppia chance 12 (nessun pareggio)",
    modelMarket: "1X2",
    modelSelection: "12",
    apiBetNames: ["Double Chance"],
    apiValues: ["Home/Away", "12"],
    settle: (home, away) => (home !== away ? "won" : "lost"),
  },
  {
    code: "OVER_1_5",
    label: "Over 1.5",
    modelMarket: "Over/Under 1.5",
    modelSelection: "Over 1.5",
    apiBetNames: ["Goals Over/Under"],
    apiValues: ["Over 1.5"],
    settle: (home, away) => (total(home, away) > 1.5 ? "won" : "lost"),
  },
  {
    code: "UNDER_1_5",
    label: "Under 1.5",
    modelMarket: "Over/Under 1.5",
    modelSelection: "Under 1.5",
    apiBetNames: ["Goals Over/Under"],
    apiValues: ["Under 1.5"],
    settle: (home, away) => (total(home, away) < 1.5 ? "won" : "lost"),
  },
  {
    code: "OVER_2_5",
    label: "Over 2.5",
    modelMarket: "Over/Under 2.5",
    modelSelection: "Over 2.5",
    apiBetNames: ["Goals Over/Under"],
    apiValues: ["Over 2.5"],
    settle: (home, away) => (total(home, away) > 2.5 ? "won" : "lost"),
  },
  {
    code: "UNDER_2_5",
    label: "Under 2.5",
    modelMarket: "Over/Under 2.5",
    modelSelection: "Under 2.5",
    apiBetNames: ["Goals Over/Under"],
    apiValues: ["Under 2.5"],
    settle: (home, away) => (total(home, away) < 2.5 ? "won" : "lost"),
  },
  {
    code: "OVER_4_5",
    label: "Over 4.5",
    modelMarket: "Over/Under 4.5",
    modelSelection: "Over 4.5",
    apiBetNames: ["Goals Over/Under"],
    apiValues: ["Over 4.5"],
    settle: (home, away) => (total(home, away) > 4.5 ? "won" : "lost"),
  },
  {
    code: "UNDER_4_5",
    label: "Under 4.5",
    modelMarket: "Over/Under 4.5",
    modelSelection: "Under 4.5",
    apiBetNames: ["Goals Over/Under"],
    apiValues: ["Under 4.5"],
    settle: (home, away) => (total(home, away) < 4.5 ? "won" : "lost"),
  },
  {
    code: "BTTS_YES",
    label: "Entrambe segnano: sì",
    modelMarket: "GG/NG",
    modelSelection: "GG",
    apiBetNames: ["Both Teams Score"],
    apiValues: ["Yes"],
    settle: (home, away) => (home > 0 && away > 0 ? "won" : "lost"),
  },
  {
    code: "BTTS_NO",
    label: "Entrambe segnano: no",
    modelMarket: "GG/NG",
    modelSelection: "NG",
    apiBetNames: ["Both Teams Score"],
    apiValues: ["No"],
    settle: (home, away) => (home > 0 && away > 0 ? "lost" : "won"),
  },
];

const BY_CODE = new Map<MarketCode, MarketSpec>(MARKETS.map((m) => [m.code, m]));

export function getMarket(code: MarketCode): MarketSpec | undefined {
  return BY_CODE.get(code);
}

/** Normalizza un token per il confronto: minuscole, senza spazi/punteggiatura. */
export function normalizeToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Parole che identificano mercati NON supportati. Se compaiono nel mercato
 * o nella selezione, la scelta viene rifiutata: senza questo controllo una
 * selezione come "Over 4.5" dei CORNER verrebbe mappata sul mercato gol
 * Over 4.5, usando la quota sbagliata e liquidando sul risultato sbagliato.
 */
const EXCLUDED_MARKET_HINTS = [
  "corner",
  "cartellin",
  "card",
  "ammoniz",
  "espulsion",
  "multigol",
  "tiri",
  "falli",
  "rimesse",
  "fuorigioco",
  "golsegnati", // "numero di gol segnati da un giocatore"
  "marcatore",
  "primotempo",
  "secondotempo",
  "handicap",
  "pariodispari",
];

/**
 * Riconosce mercato + selezione restituiti dal modello e li mappa su un
 * codice ammesso. Restituisce null se la coppia non è tra i mercati
 * supportati: in quel caso NON si deve inventare nulla.
 */
export function parseModelSelection(
  market: string,
  selection: string
): MarketCode | null {
  const m = normalizeToken(market);
  const s = normalizeToken(selection);
  if (!m && !s) return null;

  // Mercati esplicitamente fuori perimetro: mai mappati su un mercato ammesso.
  if (EXCLUDED_MARKET_HINTS.some((hint) => m.includes(hint) || s.includes(hint))) {
    return null;
  }

  // 1) corrispondenza esatta con la coppia dichiarata nel prompt
  for (const spec of MARKETS) {
    if (
      normalizeToken(spec.modelMarket) === m &&
      normalizeToken(spec.modelSelection) === s
    ) {
      return spec.code;
    }
  }

  // 2) tolleranza su sinonimi e forme compatte usate dai modelli
  const SYNONYMS: Record<string, MarketCode> = {
    "1x": "1X",
    homeordraw: "1X",
    "x2": "X2",
    draworaway: "X2",
    "12": "12",
    homeoraway: "12",
    nodraw: "12",
    over15: "OVER_1_5",
    under15: "UNDER_1_5",
    over25: "OVER_2_5",
    under25: "UNDER_2_5",
    over45: "OVER_4_5",
    under45: "UNDER_4_5",
    gg: "BTTS_YES",
    btts: "BTTS_YES",
    bttsyes: "BTTS_YES",
    yes: "BTTS_YES",
    ng: "BTTS_NO",
    bttsno: "BTTS_NO",
    no: "BTTS_NO",
  };
  const direct = SYNONYMS[s] ?? SYNONYMS[m];
  if (direct) return direct;

  // Nessun matching approssimato: una selezione ambigua non viene mai
  // associata a un mercato diverso da quello richiesto.
  return null;
}

/** Riconosce un mercato/valore di API-Football e lo mappa su un codice ammesso. */
export function parseApiMarket(
  betName: string,
  value: string
): MarketCode | null {
  const bet = normalizeToken(betName);
  const val = normalizeToken(value);
  for (const spec of MARKETS) {
    if (!spec.apiBetNames.some((n) => normalizeToken(n) === bet)) continue;
    if (spec.apiValues.some((v) => normalizeToken(v) === val)) return spec.code;
  }
  return null;
}

/**
 * Esito di un mercato rispetto al risultato finale.
 * Restituisce null se il mercato non è liquidabile: il chiamante deve
 * lasciare la giocata APERTA e segnalare il problema, mai indovinare.
 */
export function settleMarket(
  code: MarketCode,
  homeGoals: number,
  awayGoals: number
): MarketOutcome | null {
  const spec = getMarket(code);
  if (!spec) return null;
  return spec.settle(homeGoals, awayGoals);
}

/** Elenco dei mercati ammessi, per il prompt e la UI. */
export function allowedMarketList(): {
  market: string;
  selection: string;
  label: string;
}[] {
  return MARKETS.map((m) => ({
    market: m.modelMarket,
    selection: m.modelSelection,
    label: m.label,
  }));
}

// ------------------------------------------------------------
// Estrazione delle quote: da payload API-Football a mercati ammessi
// ------------------------------------------------------------

export interface ExtractedQuote {
  market: MarketCode;
  label: string;
  apiValue: string;
  odd: number;
}

export interface RawBet {
  name?: unknown;
  values?: unknown;
}

/**
 * Estrae dalle scommesse di un bookmaker SOLO i mercati ammessi.
 * Funzione PURA: usata dal client API-Football e testabile senza rete.
 * Il primo valore valido per mercato vince (ordine deterministico).
 */
export function extractQuotesFromBets(
  bets: RawBet[] | null | undefined
): Partial<Record<MarketCode, ExtractedQuote>> {
  const byMarket: Partial<Record<MarketCode, ExtractedQuote>> = {};
  if (!Array.isArray(bets)) return byMarket;

  for (const bet of bets) {
    const betName = String(bet?.name ?? "");
    if (!Array.isArray(bet?.values)) continue;
    for (const entry of bet.values as { value?: unknown; odd?: unknown }[]) {
      const apiValue = String(entry?.value ?? "");
      const raw = entry?.odd;
      const odd = typeof raw === "number" ? raw : Number(raw);
      if (!Number.isFinite(odd) || odd <= 1) continue;
      const code = parseApiMarket(betName, apiValue);
      if (!code || byMarket[code]) continue;
      byMarket[code] = { market: code, label: apiValue, apiValue, odd };
    }
  }
  return byMarket;
}

// ------------------------------------------------------------
// Matematica di quota equa ed EV
//
// Regola tassativa: senza una quota bookmaker REALE (> 1) l'EV non è
// calcolabile e resta null. Mai 0, mai -1, mai una quota inventata.
// ------------------------------------------------------------

/** Quota bookmaker valida (> 1) oppure null. */
export function asBookmakerOdds(value: number | null | undefined): number | null {
  return value != null && Number.isFinite(value) && value > 1 ? value : null;
}

/** Quota equa = 1 / probabilità. Dipende solo dalla probabilità stimata. */
export function computeFairOdds(probability: number): number {
  if (!Number.isFinite(probability) || probability <= 0) return 0;
  return Number((1 / probability).toFixed(2));
}

/** EV = p × quota − 1. null quando la quota reale manca. */
export function computeEv(
  probability: number,
  bookmakerOdds: number | null | undefined
): number | null {
  const odds = asBookmakerOdds(bookmakerOdds);
  if (odds == null || !Number.isFinite(probability) || probability <= 0) return null;
  return Number((probability * odds - 1).toFixed(4));
}
