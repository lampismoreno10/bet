// ============================================================
// Self-test mirati della pipeline BET.
//
// Esecuzione:  npm test        (= node --no-warnings scripts/self-test.ts)
//
// Nessuna dipendenza esterna e nessuna rete: i moduli sotto test sono puri
// (mercati, matematica delle quote, throttle, OpenFootball). Node 24 esegue
// direttamente i file .ts, quindi non serve compilare né installare nulla.
//
// I percorsi sono relativi e con estensione .ts esplicita: è il formato che
// Node richiede per risolvere i moduli TypeScript.
// ============================================================

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  MARKETS,
  allowedMarketList,
  asBookmakerOdds,
  computeEv,
  computeFairOdds,
  extractQuotesFromBets,
  getMarket,
  parseApiMarket,
  parseModelSelection,
  settleMarket,
  type MarketCode,
} from "../src/lib/sports/markets.ts";
import {
  ApiThrottle,
  API_DAILY_RESERVE,
  readQuotaHeaders,
} from "../src/lib/sports/throttle.ts";
import {
  buildLeagueFromJson,
  hasOpenFootballDataset,
  normalizeTeamName,
  OPENFOOTBALL_DATASETS,
  resolveOpenFootballTeam,
  type OpenFootballDataset,
} from "../src/lib/sports/openfootball.ts";
import {
  buildSchedina,
  DECISION_THRESHOLDS,
  decideAnalysis,
  SCHEDINA_MAX_EVENTS,
} from "../src/lib/sports/decision.ts";
import { TRACKED_LEAGUES } from "../src/lib/sports/leagues.ts";

// ------------------------------------------------------------
// Mini harness
// ------------------------------------------------------------
let passed = 0;
const failures: string[] = [];

function test(name: string, fn: () => void) {
  try {
    fn();
    passed += 1;
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures.push(`${name}: ${err instanceof Error ? err.message : String(err)}`);
    console.log(`  FAIL ${name}`);
  }
}

function section(title: string) {
  console.log(`\n== ${title} ==`);
}

// ============================================================
section("EV con quota reale / EV null senza quota");
// ============================================================
test("quota reale 2.10 e p=0.5 => EV +0.05", () => {
  assert.equal(computeEv(0.5, 2.1), 0.05);
});
test("quota 1.50 e p=0.60 => EV -0.10", () => {
  assert.equal(computeEv(0.6, 1.5), -0.1);
});
test("EV null quando la quota manca (null/undefined/0/NaN)", () => {
  assert.equal(computeEv(0.5, null), null);
  assert.equal(computeEv(0.5, undefined), null);
  assert.equal(computeEv(0.5, 0), null);
  assert.equal(computeEv(0.5, Number.NaN), null);
});
test("EV null con probabilità non valida", () => {
  assert.equal(computeEv(0, 2.1), null);
  assert.equal(computeEv(-0.2, 2.1), null);
});
test("EV mai 0 o -1 per quota assente (regressione)", () => {
  assert.notEqual(computeEv(0.5, 0), 0);
  assert.notEqual(computeEv(0.5, 0), -1);
});
test("quota equa = 1/p, indipendente dalla quota bookmaker", () => {
  assert.equal(computeFairOdds(0.5), 2);
  assert.equal(computeFairOdds(0.25), 4);
  assert.equal(computeFairOdds(0), 0);
});

// ============================================================
section("Validazione quote (mai inventate)");
// ============================================================
test("asBookmakerOdds accetta solo > 1", () => {
  assert.equal(asBookmakerOdds(1.01), 1.01);
  assert.equal(asBookmakerOdds(2.5), 2.5);
  assert.equal(asBookmakerOdds(1), null);
  assert.equal(asBookmakerOdds(0.99), null);
  assert.equal(asBookmakerOdds(0), null);
  assert.equal(asBookmakerOdds(-3), null);
  assert.equal(asBookmakerOdds(null), null);
  assert.equal(asBookmakerOdds(undefined), null);
  assert.equal(asBookmakerOdds(Number.POSITIVE_INFINITY), null);
});

// ============================================================
section("Parsing delle quote API-Football");
// ============================================================
const apiBets = [
  {
    id: 1,
    name: "Match Winner",
    values: [
      { value: "Home", odd: "1.80" },
      { value: "Draw", odd: "3.40" },
      { value: "Away", odd: "4.20" },
    ],
  },
  {
    id: 5,
    name: "Goals Over/Under",
    values: [
      { value: "Over 1.5", odd: "1.25" },
      { value: "Under 1.5", odd: "3.80" },
      { value: "Over 2.5", odd: "1.85" },
      { value: "Under 2.5", odd: "1.95" },
      { value: "Over 4.5", odd: "5.50" },
      { value: "Under 4.5", odd: "1.12" },
      { value: "Over 3.5", odd: "3.10" },
    ],
  },
  { id: 12, name: "Both Teams Score", values: [{ value: "Yes", odd: "1.70" }, { value: "No", odd: "2.05" }] },
  { id: 8, name: "Corners Over Under", values: [{ value: "Over 9.5", odd: "1.90" }] },
  { id: 2, name: "Goals Over/Under First Half", values: [{ value: "Over 1.5", odd: "2.60" }] },
];

test("estrae SOLO i mercati ammessi (corner e 1° tempo esclusi)", () => {
  const quotes = extractQuotesFromBets(apiBets);
  const codes = Object.keys(quotes).sort();
  assert.deepEqual(codes, [
    "BTTS_NO",
    "BTTS_YES",
    "OVER_1_5",
    "OVER_2_5",
    "OVER_4_5",
    "UNDER_1_5",
    "UNDER_2_5",
    "UNDER_4_5",
  ]);
});
test("gli esiti singoli 1/X/2 NON sono ammessi: scartati", () => {
  const quotes = extractQuotesFromBets(apiBets);
  assert.equal(quotes.OVER_2_5?.odd, 1.85);
  assert.equal(Object.values(quotes).length, 8);
});
test("il mercato del primo tempo non viene confuso con quello dei 90'", () => {
  const quotes = extractQuotesFromBets([
    { name: "Goals Over/Under First Half", values: [{ value: "Over 1.5", odd: "2.60" }] },
  ]);
  assert.equal(Object.keys(quotes).length, 0);
});
test("quota non valida (<= 1 o non numerica) scartata", () => {
  const quotes = extractQuotesFromBets([
    { name: "Both Teams Score", values: [{ value: "Yes", odd: "1.00" }, { value: "No", odd: "abc" }] },
  ]);
  assert.equal(Object.keys(quotes).length, 0);
});
test("doppia chance riconosciuta nei valori API", () => {
  assert.equal(parseApiMarket("Double Chance", "Home/Draw"), "1X");
  assert.equal(parseApiMarket("Double Chance", "Draw/Away"), "X2");
  assert.equal(parseApiMarket("Double Chance", "Home/Away"), "12");
  assert.equal(parseApiMarket("Both Teams Score", "Yes"), "BTTS_YES");
  assert.equal(parseApiMarket("Both Teams Score", "No"), "BTTS_NO");
  assert.equal(parseApiMarket("Match Winner", "Home"), null);
});

// ============================================================
section("Validazione della scelta del modello");
// ============================================================
test("ogni mercato dichiarato nel prompt viene riconosciuto", () => {
  for (const m of allowedMarketList()) {
    assert.equal(parseModelSelection(m.market, m.selection), parseModelSelection(m.market, m.selection));
    assert.notEqual(parseModelSelection(m.market, m.selection), null, `${m.market}/${m.selection}`);
  }
});
test("sinonimi tollerati", () => {
  assert.equal(parseModelSelection("over/under 2.5", "over2.5"), "OVER_2_5");
  assert.equal(parseModelSelection("BTTS", "GG"), "BTTS_YES");
  assert.equal(parseModelSelection("1X2", "12"), "12");
});
test("mercato non supportato => null (nessuna quota inventata)", () => {
  assert.equal(parseModelSelection("Corner", "Over 9.5"), null);
  assert.equal(parseModelSelection("Cartellini", "Over 4.5"), null);
  assert.equal(parseModelSelection("Multigol", "1-3 gol"), null);
  assert.equal(parseModelSelection("", ""), null);
});

// ============================================================
section("Settlement dal solo risultato finale");
// ============================================================
test("doppia chance 1X / X2 / 12", () => {
  assert.equal(settleMarket("1X", 2, 1), "won");
  assert.equal(settleMarket("1X", 1, 1), "won");
  assert.equal(settleMarket("1X", 0, 1), "lost");
  assert.equal(settleMarket("X2", 0, 1), "won");
  assert.equal(settleMarket("X2", 1, 1), "won");
  assert.equal(settleMarket("X2", 2, 1), "lost");
  assert.equal(settleMarket("12", 2, 1), "won");
  assert.equal(settleMarket("12", 1, 1), "lost");
  assert.equal(settleMarket("12", 0, 3), "won");
});
test("Over/Under 1.5", () => {
  assert.equal(settleMarket("OVER_1_5", 1, 1), "won");
  assert.equal(settleMarket("OVER_1_5", 1, 0), "lost");
  assert.equal(settleMarket("UNDER_1_5", 1, 0), "won");
  assert.equal(settleMarket("UNDER_1_5", 2, 0), "lost");
});
test("Over/Under 2.5", () => {
  assert.equal(settleMarket("OVER_2_5", 2, 1), "won");
  assert.equal(settleMarket("OVER_2_5", 1, 1), "lost");
  assert.equal(settleMarket("UNDER_2_5", 1, 1), "won");
  assert.equal(settleMarket("UNDER_2_5", 2, 2), "lost");
});
test("Over/Under 4.5", () => {
  assert.equal(settleMarket("OVER_4_5", 3, 2), "won");
  assert.equal(settleMarket("OVER_4_5", 2, 2), "lost");
  assert.equal(settleMarket("UNDER_4_5", 2, 2), "won");
  assert.equal(settleMarket("UNDER_4_5", 3, 3), "lost");
});
test("BTTS si / no", () => {
  assert.equal(settleMarket("BTTS_YES", 1, 2), "won");
  assert.equal(settleMarket("BTTS_YES", 3, 0), "lost");
  assert.equal(settleMarket("BTTS_NO", 3, 0), "won");
  assert.equal(settleMarket("BTTS_NO", 0, 0), "won");
  assert.equal(settleMarket("BTTS_NO", 2, 2), "lost");
});
test("tutti i mercati ammessi sono liquidabili e mai 'void'", () => {
  for (const spec of MARKETS) {
    const outcome = spec.settle(1, 0);
    assert.ok(outcome === "won" || outcome === "lost", spec.code);
  }
});
test("un codice non supportato resta non liquidabile", () => {
  assert.equal(settleMarket("MULTIGOL" as MarketCode, 2, 1), null);
  assert.equal(getMarket("MULTIGOL" as MarketCode), undefined);
});

// ============================================================
section("Settlement: calcolo del profitto");
// ============================================================
test("profit won = stake*(odds-1), lost = -stake", () => {
  const stake = 10;
  const odds = 2.1;
  const won = Number((stake * (odds - 1)).toFixed(2));
  const lost = Number((-stake).toFixed(2));
  assert.equal(won, 11);
  assert.equal(lost, -10);
  assert.equal(Number((won + lost).toFixed(2)), 1);
});

// ============================================================
section("Rate limit / quota API-Football");
// ============================================================
test("gli header di quota sono letti in entrambe le convenzioni", () => {
  const a = readQuotaHeaders(new Headers({ "x-ratelimit-requests-limit": "100", "x-ratelimit-requests-remaining": "42" }));
  assert.deepEqual(a, { limit: 100, remaining: 42 });
  const b = readQuotaHeaders(new Headers({ "X-RateLimit-Limit": "100", "X-RateLimit-Remaining": "7" }));
  assert.deepEqual(b, { limit: 100, remaining: 7 });
  assert.deepEqual(readQuotaHeaders(new Headers()), { limit: null, remaining: null });
});
test("la riserva giornaliera blocca le analisi quando la quota è bassa", () => {
  const t = new ApiThrottle();
  t.recordQuota(new Headers({ "x-ratelimit-requests-remaining": String(API_DAILY_RESERVE + 1) }));
  assert.equal(t.canSpend(1), true);
  t.recordQuota(new Headers({ "x-ratelimit-requests-remaining": String(API_DAILY_RESERVE) }));
  assert.equal(t.canSpend(1), false);
  t.recordQuota(new Headers({ "x-ratelimit-requests-remaining": String(API_DAILY_RESERVE + 2) }));
  assert.equal(t.canSpend(2), true);
  assert.equal(t.canSpend(3), false);
});
test("quota sconosciuta: si procede (meglio un 429 gestito)", () => {
  const t = new ApiThrottle();
  assert.equal(t.canSpend(5), true);
});
test("dopo un 429 non si spende più quota", () => {
  const t = new ApiThrottle();
  t.recordQuota(new Headers({ "x-ratelimit-requests-remaining": "90" }));
  assert.equal(t.canSpend(1), true);
  t.markRateLimited();
  assert.equal(t.canSpend(1), false);
  assert.equal(t.isRateLimited(), true);
});
test("intervallo minimo rispettato fra due richieste", async () => {
  const t = new ApiThrottle({ minIntervalMs: 60 });
  await t.waitTurn();
  const start = Date.now();
  await t.waitTurn();
  const elapsed = Date.now() - start;
  assert.ok(elapsed >= 50, `atteso >= 50ms, misurato ${elapsed}ms`);
});
test("reset azzera quota e stato di rate limit", () => {
  const t = new ApiThrottle();
  t.markRateLimited();
  t.recordQuota(new Headers({ "x-ratelimit-requests-remaining": "5" }));
  t.reset();
  assert.equal(t.isRateLimited(), false);
  assert.deepEqual(t.getQuota(), { limit: null, remaining: null });
});

// ============================================================
section("OpenFootball: aggregazione e classifica");
// ============================================================
const DATASET: OpenFootballDataset = { url: "https://example.invalid/x.json", label: "Test League" };
const rawLeague = {
  name: "Test League 2026/27",
  matches: [
    { round: "MD1", date: "2026-08-01", team1: "AC Milan", team2: "FC Internazionale Milano", score: { ft: [2, 1], ht: [1, 0] } },
    { round: "MD2", date: "2026-08-08", team1: "FC Internazionale Milano", team2: "1. FC Köln", score: { ft: [0, 0] } },
    { round: "MD3", date: "2026-08-15", team1: "1. FC Köln", team2: "AC Milan", score: { ft: [3, 3] } },
    { round: "MD4", date: "2026-08-22", team1: "AC Milan", team2: "1. FC Köln" },
  ],
};
const league = buildLeagueFromJson(rawLeague, DATASET, 999);

test("conta solo le partite con risultato finale", () => {
  assert.equal(league.playedMatches, 3);
  assert.equal(league.teams.size, 3);
  assert.equal(league.datasetLabel, "Test League");
  assert.equal(league.leagueId, 999);
});
test("vittorie/pareggi/sconfitte, gol e punti", () => {
  const milan = league.teams.get("AC Milan");
  assert.ok(milan);
  assert.equal(milan.played, 2);
  assert.equal(milan.wins, 1);
  assert.equal(milan.draws, 1);
  assert.equal(milan.losses, 0);
  assert.equal(milan.goalsFor, 5);
  assert.equal(milan.goalsAgainst, 4);
  assert.equal(milan.goalDifference, 1);
  assert.equal(milan.points, 4);
});
test("medie gol", () => {
  const milan = league.teams.get("AC Milan");
  assert.equal(milan?.avgGoalsFor, 2.5);
  assert.equal(milan?.avgGoalsAgainst, 2);
});
test("classifica ordinata per punti, DR, gol fatti", () => {
  assert.deepEqual(
    league.standings.map((t) => [t.rank, t.team, t.points]),
    [
      [1, "AC Milan", 4],
      [2, "1. FC Köln", 2],
      [3, "FC Internazionale Milano", 1],
    ]
  );
});
test("percentuali Over/Under/BTTS sulla stagione", () => {
  const koln = league.teams.get("1. FC Köln");
  // Partite: 0-0 (totale 0) e 3-3 (totale 6).
  assert.equal(koln?.over15, 0.5);
  assert.equal(koln?.over25, 0.5);
  assert.equal(koln?.under45, 0.5);
  assert.equal(koln?.btts, 0.5);
});
test("forma casa/trasferta e ultime 5 in ordine cronologico", () => {
  const inter = league.teams.get("FC Internazionale Milano");
  assert.equal(inter?.homeForm, "D");
  assert.equal(inter?.awayForm, "L");
  assert.equal(inter?.seasonForm, "LD");
  assert.deepEqual(inter?.last5.map((m) => m.date), ["2026-08-01", "2026-08-08"]);
});
test("le partite non giocate non entrano in alcuna statistica", () => {
  const milan = league.teams.get("AC Milan");
  assert.equal(milan?.played, 2);
  assert.equal(milan?.last5.length, 2);
});

// ============================================================
section("OpenFootball: risoluzione nomi squadra");
// ============================================================
test("nome canonico e varianti brevi si risolvono", () => {
  assert.equal(resolveOpenFootballTeam("AC Milan", league), "AC Milan");
  assert.equal(resolveOpenFootballTeam("Milan", league), "AC Milan");
  assert.equal(resolveOpenFootballTeam("Inter", league), "FC Internazionale Milano");
  assert.equal(resolveOpenFootballTeam("Inter Milan", league), "FC Internazionale Milano");
});
test("accenti e token societari non impediscono la corrispondenza", () => {
  assert.equal(resolveOpenFootballTeam("FC Koln", league), "1. FC Köln");
  assert.equal(resolveOpenFootballTeam("Köln", league), "1. FC Köln");
  assert.equal(normalizeTeamName("1. FC Köln"), "koln");
});
test("una squadra sconosciuta NON viene associata (resta in attesa)", () => {
  assert.equal(resolveOpenFootballTeam("Hellas Verona", league), null);
  assert.equal(resolveOpenFootballTeam("Real Madrid", league), null);
  assert.equal(resolveOpenFootballTeam("", league), null);
});
test("un nome ambiguo non viene risolto", () => {
  const ambiguous = buildLeagueFromJson(
    {
      name: "Amb",
      matches: [
        { date: "2026-08-01", team1: "Test FC", team2: "Altro FC", score: { ft: [1, 0] } },
        { date: "2026-08-02", team1: "Test AC", team2: "Altro AC", score: { ft: [0, 1] } },
      ],
    },
    DATASET,
    998
  );
  assert.equal(resolveOpenFootballTeam("Test", ambiguous), null);
});
test("gli alias non si applicano alle leghe sbagliate", () => {
  // "Inter" esiste solo come alias: in una lega senza quella squadra resta null.
  const altra = buildLeagueFromJson(
    { name: "Alt", matches: [{ date: "2026-08-01", team1: "Alfa", team2: "Beta", score: { ft: [1, 0] } }] },
    DATASET,
    997
  );
  assert.equal(resolveOpenFootballTeam("Inter", altra), null);
});

// ============================================================
section("Copertura OpenFootball e fallback API-Football");
// ============================================================
test("le 6 competizioni verificate sono configurate", () => {
  const configured = Object.keys(OPENFOOTBALL_DATASETS).map(Number).sort((a, b) => a - b);
  assert.deepEqual(configured, [39, 40, 61, 78, 135, 140]);
});
test("ogni dataset punta al 2026-27 del repository OpenFootball", () => {
  for (const [id, d] of Object.entries(OPENFOOTBALL_DATASETS)) {
    assert.ok(d.url.startsWith("https://raw.githubusercontent.com/openfootball/football.json/master/2026-27/"), id);
    assert.ok(d.url.endsWith(".json"), id);
    assert.ok(d.label.length > 0, id);
  }
});
test("Serie B NON è coperta (dataset 404): userà il fallback", () => {
  assert.equal(hasOpenFootballDataset(136, 2026), false);
  const filename = "it.2.json";
  const urls = Object.values(OPENFOOTBALL_DATASETS).map((d) => d.url);
  assert.equal(urls.some((u) => u.endsWith(filename)), false);
});
test("coppe, nazionali e qualificazioni usano il fallback /predictions", () => {
  for (const nonCoperta of [2, 3, 848, 1, 5, 9, 32, 34, 960, 136]) {
    assert.equal(hasOpenFootballDataset(nonCoperta, 2026), false, String(nonCoperta));
  }
});
test("stagione non 2026 => dataset non applicabile (si usa il fallback)", () => {
  assert.equal(hasOpenFootballDataset(135, 2026), true);
  assert.equal(hasOpenFootballDataset(135, null), true);
  assert.equal(hasOpenFootballDataset(135, 2025), false);
});
test("tutta la whitelist è gestibile: dataset oppure fallback", () => {
  for (const l of TRACKED_LEAGUES) {
    const coperta = hasOpenFootballDataset(l.id, 2026);
    const fallback = !coperta;
    assert.ok(coperta || fallback, l.name);
  }
  assert.ok(TRACKED_LEAGUES.length >= 16);
  // Competizioni per club coperte da dataset: Serie A, Premier, Championship,
  // La Liga, Bundesliga, Ligue 1 (Serie B esclusa: dataset 404).
  const clubCoperti = TRACKED_LEAGUES.filter(
    (l) => l.kind === "club" && hasOpenFootballDataset(l.id, 2026)
  );
  assert.equal(clubCoperti.length, 6);
});

// ============================================================
section("Motore decisionale — soglie OpenFootball");
// ============================================================
const OF = {
  statsSource: "openfootball" as const,
  hasRealOdds: true,
  marketSupported: true,
};

test("OpenFootball EV 4.9% -> scartata", () => {
  assert.equal(decideAnalysis({ ...OF, ev: 0.049, confidence: 90 }).state, "scartata");
});
test("OpenFootball EV 5% e confidence 65 -> giocabile", () => {
  const d = decideAnalysis({ ...OF, ev: 0.05, confidence: 65 });
  assert.equal(d.state, "giocabile");
  assert.deepEqual(d.thresholds, { minEv: 0.05, minConfidence: 65 });
});
test("OpenFootball confidence 64 -> scartata", () => {
  assert.equal(decideAnalysis({ ...OF, ev: 0.2, confidence: 64 }).state, "scartata");
});
test("OpenFootball EV 5% con confidence 100 -> giocabile (limite incluso)", () => {
  assert.equal(decideAnalysis({ ...OF, ev: 0.05, confidence: 100 }).state, "giocabile");
});
test("OpenFootball EV negativo -> scartata", () => {
  assert.equal(decideAnalysis({ ...OF, ev: -0.1, confidence: 99 }).state, "scartata");
});

// ============================================================
section("Motore decisionale — soglie fallback API-Football");
// ============================================================
const FB = {
  statsSource: "api-football-prediction" as const,
  hasRealOdds: true,
  marketSupported: true,
};

test("fallback EV 7.9% -> scartata", () => {
  assert.equal(decideAnalysis({ ...FB, ev: 0.079, confidence: 95 }).state, "scartata");
});
test("fallback EV 8% e confidence 70 -> giocabile", () => {
  const d = decideAnalysis({ ...FB, ev: 0.08, confidence: 70 });
  assert.equal(d.state, "giocabile");
  assert.deepEqual(d.thresholds, { minEv: 0.08, minConfidence: 70 });
});
test("fallback confidence 69 -> scartata", () => {
  assert.equal(decideAnalysis({ ...FB, ev: 0.3, confidence: 69 }).state, "scartata");
});
test("le soglie del fallback sono più severe di OpenFootball", () => {
  assert.ok(
    DECISION_THRESHOLDS["api-football-prediction"].minEv >
      DECISION_THRESHOLDS.openfootball.minEv
  );
  assert.ok(
    DECISION_THRESHOLDS["api-football-prediction"].minConfidence >
      DECISION_THRESHOLDS.openfootball.minConfidence
  );
});
test("lo stesso EV 6% e' giocabile con OpenFootball ma scartata in fallback", () => {
  assert.equal(decideAnalysis({ ...OF, ev: 0.06, confidence: 75 }).state, "giocabile");
  assert.equal(decideAnalysis({ ...FB, ev: 0.06, confidence: 75 }).state, "scartata");
});

// ============================================================
section("Motore decisionale — dati mancanti => da_valutare");
// ============================================================
test("quota reale mancante -> da_valutare, mai giocabile", () => {
  const d = decideAnalysis({
    ...OF,
    hasRealOdds: false,
    ev: null,
    confidence: 99,
  });
  assert.equal(d.state, "da_valutare");
  assert.equal(d.thresholds, null);
});
test("quota reale mancante ma EV presente -> comunque da_valutare", () => {
  assert.equal(
    decideAnalysis({ ...OF, hasRealOdds: false, ev: 0.3, confidence: 99 }).state,
    "da_valutare"
  );
});
test("mercato non valido -> da_valutare anche con EV alto", () => {
  const d = decideAnalysis({ ...OF, marketSupported: false, ev: 0.3, confidence: 95 });
  assert.equal(d.state, "da_valutare");
});
test("contesto statistico assente -> da_valutare", () => {
  const d = decideAnalysis({
    statsSource: null,
    ev: 0.3,
    confidence: 95,
    hasRealOdds: true,
    marketSupported: true,
  });
  assert.equal(d.state, "da_valutare");
});
test("EV non calcolabile -> da_valutare", () => {
  assert.equal(decideAnalysis({ ...OF, ev: null, confidence: 99 }).state, "da_valutare");
});
test("le note spiegano la decisione (tracciabilita')", () => {
  assert.ok(
    decideAnalysis({ ...OF, ev: 0.05, confidence: 65 }).notes.join(" ").includes("giocabile")
  );
  assert.ok(
    decideAnalysis({ ...OF, ev: 0.01, confidence: 90 }).notes.join(" ").includes("scartata")
  );
  assert.ok(
    decideAnalysis({ ...OF, hasRealOdds: false, ev: null, confidence: 90 })
      .notes.join(" ")
      .includes("quota")
  );
});
test("nessuna quota minima obbligatoria nelle soglie", () => {
  for (const t of Object.values(DECISION_THRESHOLDS)) {
    assert.equal(Object.prototype.hasOwnProperty.call(t, "minOdds"), false);
  }
});

// ============================================================
section("Schedina preparata (non ancora costruita dalla pipeline)");
// ============================================================
test("massimo 2 eventi con quota combinata preferita 1.70-2.20", () => {
  const s = buildSchedina([
    { id: "a", odds: 1.4, ev: 0.08, confidence: 70 },
    { id: "b", odds: 1.35, ev: 0.07, confidence: 70 },
    { id: "c", odds: 3.0, ev: 0.09, confidence: 70 },
  ]);
  assert.ok(s);
  assert.ok(s.picks.length <= SCHEDINA_MAX_EVENTS);
  assert.equal(s.inTargetRange, true);
  assert.ok(s.totalOdds >= 1.7 && s.totalOdds <= 2.2);
});
test("senza selezioni valide restituisce null (non si forza nulla)", () => {
  assert.equal(buildSchedina([]), null);
});
test("quota fuori intervallo viene segnalata, non forzata", () => {
  const s = buildSchedina([{ id: "a", odds: 5, ev: 0.1, confidence: 80 }]);
  assert.ok(s);
  assert.equal(s.inTargetRange, false);
});
test("EV combinato = (1+ev1)(1+ev2)-1", () => {
  const s = buildSchedina([
    { id: "a", odds: 1.4, ev: 0.05, confidence: 70 },
    { id: "b", odds: 1.4, ev: 0.1, confidence: 70 },
  ]);
  assert.ok(s);
  assert.equal(s.picks.length, 2);
  assert.equal(s.combinedEv, Number((1.05 * 1.1 - 1).toFixed(4)));
});
test("quote non valide vengono ignorate", () => {
  assert.equal(buildSchedina([{ id: "a", odds: 0, ev: 0.1, confidence: 80 }]), null);
});

// ============================================================
section("Prompt DeepSeek allineato alle regole decisionali");
// ============================================================
test("il modello non deve produrre state / EV / quota equa", () => {
  const src = readFileSync("src/lib/ai/deepseek.ts", "utf8");
  assert.ok(src.includes("COSA NON DEVI PRODURRE"));
  assert.equal(src.includes('"state": string'), false);
  assert.equal(src.includes('"fairOdds": number'), false);
  assert.equal(src.includes("normalizeState"), false);
  // il codice non legge più lo stato dalla risposta del modello
  assert.equal(/json\.state/.test(src), false);
});
test("il prompt impone prudenza e segnala la stima esterna", () => {
  const src = readFileSync("src/lib/ai/deepseek.ts", "utf8");
  assert.ok(src.includes("Sii PRUDENTE"));
  assert.ok(src.includes("non alzare \"estimatedProbability\" solo perché API-Football"));
  assert.ok(src.includes("ABBASSA \"confidence\""));
  assert.ok(src.includes("NON una statistica indipendente verificata"));
  assert.ok(src.includes("QUOTE REALI DISPONIBILI"));
  assert.ok(src.includes("è normale e frequente che una partita non sia giocabile"));
});
test("lo stato viene deciso solo dal motore server-side", () => {
  const src = readFileSync("src/app/(dashboard)/analysis-actions.ts", "utf8");
  assert.ok(src.includes("decideAnalysis("));
  assert.ok(src.includes("decision.state"));
});

// ============================================================
section("Giocate duplicate: vincolo nel database");
// ============================================================
test("la migration 004 dichiara l'unicità (user_id, analysis_id)", () => {
  const sql = readFileSync("supabase/migrations/004_unique_bet_and_bookmaker.sql", "utf8");
  assert.ok(/create unique index[\s\S]*bets[\s\S]*\(user_id, analysis_id\)/i.test(sql));
  assert.ok(/bookmaker/i.test(sql));
});
test("markAsPlayed rifiuta una quota assente (nessun odds = 0)", () => {
  const src = readFileSync("src/app/(dashboard)/actions.ts", "utf8");
  assert.ok(src.includes("Quota bookmaker reale assente"));
  assert.ok(src.includes("Esiste già una giocata per questa analisi"));
  assert.equal(src.includes("odds: analysis.bet365_odds ?? 0"), false);
});

// ============================================================
section("Sicurezza: niente segreti nel client");
// ============================================================
test("le chiavi server non hanno prefisso NEXT_PUBLIC_", () => {
  const env = readFileSync(".env.example", "utf8");
  for (const key of ["SPORTS_API_KEY=", "DEEPSEEK_API_KEY=", "CRON_SECRET=", "SUPABASE_SERVICE_ROLE_KEY="]) {
    assert.ok(env.includes(`\n${key}`), `manca ${key}`);
    assert.equal(env.includes(`NEXT_PUBLIC_${key}`), false, `esposto al client: ${key}`);
  }
});
test("ADMIN_EMAILS vuota non abilita admin in produzione", () => {
  const src = readFileSync("src/lib/config.ts", "utf8");
  assert.ok(src.includes('process.env.NODE_ENV !== "production"'));
});

// ============================================================
// Esito
// ============================================================
console.log(`\n${"=".repeat(60)}`);
if (failures.length === 0) {
  console.log(`TUTTI I ${passed} TEST PASSATI`);
} else {
  console.log(`${passed} passati, ${failures.length} FALLITI:`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exitCode = 1;
}
