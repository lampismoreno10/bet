/**
 * ProphitBet v2 CSV bridge (original application: MIT, kochlisGit).
 *
 * This module does NOT implement or impersonate ProphitBet's ML model.
 * It reads the CSV produced by its "Predict Fixtures -> Export" action,
 * derives double-chance probabilities from exported 1/X/2 probabilities,
 * and produces an experimental two-match suggestion using FAIR (not actual)
 * odds. Nothing is saved and no external API is called.
 *
 * Original format: Home Team,Away Team,1,X,2,Predicted,Prob(1),Prob(X),Prob(2)
 *                 Home Team,Away Team,1,X,2,Predicted,Prob(U),Prob(O)
 * Under/Over means 2.5 goals in the upstream source.
 */

export type ProphitBetKind = "result" | "goals_2_5";

export interface ProphitBetPrediction {
  fixtureDate: string;
  homeTeam: string;
  awayTeam: string;
  kind: ProphitBetKind;
  sourceFile: string;
  predicted: string;
  probabilities: {
    home?: number;
    draw?: number;
    away?: number;
    under25?: number;
    over25?: number;
  };
}

export interface ProphitBetWarning {
  sourceFile: string;
  line: number;
  reason: string;
}

export interface ProphitBetCsvResult {
  predictions: ProphitBetPrediction[];
  warnings: ProphitBetWarning[];
}

export type ProphitBetMarket =
  | "1"
  | "X"
  | "2"
  | "1X"
  | "X2"
  | "12"
  | "UNDER_2_5"
  | "OVER_2_5";

export interface ProphitBetPick {
  fixtureKey: string;
  fixtureDate: string;
  homeTeam: string;
  awayTeam: string;
  market: ProphitBetMarket;
  probability: number;
  /** Inverse model probability; NOT a bookmaker price. */
  fairOdds: number;
  sourceFile: string;
}

export interface ProphitBetDouble {
  picks: [ProphitBetPick, ProphitBetPick];
  combinedProbability: number;
  /** Only a model-implied theoretical price, never a quoted bookmaker price. */
  combinedFairOdds: number;
}

const MAX_CSV_ROWS = 2000;
const MAX_TEAM_LENGTH = 150;
const MIN_SUGGESTION_PROBABILITY = 0.65;
const TARGET_FAIR_ODDS_MIN = 1.7;
const TARGET_FAIR_ODDS_MAX = 2.0;

type CsvRow = { cells: string[]; line: number };

/** Small RFC4180-compatible CSV reader: escaped quotes, commas, CRLF, BOM. */
function readCsv(text: string): CsvRow[] {
  if (!text.trim()) throw new Error("Il CSV e' vuoto.");
  const csv = text.replace(/^\uFEFF/, "");
  const rows: CsvRow[] = [];
  let cells: string[] = [];
  let value = "";
  let quoted = false;
  let line = 1;
  let rowStart = 1;

  function finishRow() {
    cells.push(value.trim());
    if (cells.some((cell) => cell !== "")) {
      rows.push({ cells, line: rowStart });
      if (rows.length > MAX_CSV_ROWS + 1) {
        throw new Error("CSV troppo grande: massimo 2000 righe di dati.");
      }
    }
    cells = [];
    value = "";
    rowStart = line + 1;
  }

  for (let i = 0; i < csv.length; i += 1) {
    const char = csv[i];
    if (char === '"') {
      if (quoted && csv[i + 1] === '"') {
        value += '"';
        i += 1;
      } else if (quoted) {
        quoted = false;
      } else if (value === "") {
        quoted = true;
      } else {
        throw new Error("CSV non valido: virgolette inattese alla riga " + line + ".");
      }
    } else if (char === "," && !quoted) {
      cells.push(value.trim());
      value = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && csv[i + 1] === "\n") i += 1;
      finishRow();
      line += 1;
    } else {
      value += char;
      if (char === "\n") line += 1;
    }
  }
  if (quoted) throw new Error("CSV non valido: virgolette non chiuse.");
  if (value !== "" || cells.length > 0) finishRow();
  if (rows.length < 2) throw new Error("CSV senza righe di previsioni.");
  return rows;
}

function validFixtureDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value + "T00:00:00.000Z");
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function fieldIndex(headers: string[], name: string): number {
  return headers.indexOf(name.toLowerCase());
}

function probability(cell: string): number | null {
  const trimmed = cell.trim();
  if (!trimmed) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) && value >= 0 && value <= 1 ? value : null;
}

function nearOne(values: number[]): boolean {
  return Math.abs(values.reduce((sum, n) => sum + n, 0) - 1) <= 0.025;
}

export function normalizeProphitBetTeam(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export function prophitBetFixtureKey(item: {
  fixtureDate: string;
  homeTeam: string;
  awayTeam: string;
}): string {
  return [
    item.fixtureDate,
    normalizeProphitBetTeam(item.homeTeam),
    normalizeProphitBetTeam(item.awayTeam),
  ].join("|");
}

export function prophitBetPredictionKey(item: ProphitBetPrediction): string {
  return prophitBetFixtureKey(item) + "|" + item.kind;
}

export function parseProphitBetCsv(
  text: string,
  sourceFile: string,
  fixtureDate: string,
): ProphitBetCsvResult {
  if (!validFixtureDate(fixtureDate)) {
    throw new Error("Seleziona una data valida per le partite del CSV.");
  }
  const rows = readCsv(text);
  const headers = rows[0].cells.map((name) => name.toLowerCase().trim());
  const header = (name: string) => fieldIndex(headers, name);
  const baseFields = ["Home Team", "Away Team", "1", "X", "2", "Predicted"];
  if (!baseFields.every((name) => header(name) >= 0)) {
    throw new Error("CSV non riconosciuto: usa Export di ProphitBet (Predict Fixtures).");
  }

  const resultFields = ["Prob(1)", "Prob(X)", "Prob(2)"];
  const goalsFields = ["Prob(U)", "Prob(O)"];
  const isResult = resultFields.every((name) => header(name) >= 0);
  const isGoals = goalsFields.every((name) => header(name) >= 0);
  if (isResult === isGoals) {
    throw new Error(
      "CSV ambiguo: usa un file solo per Result (1/X/2) oppure U/O-2.5.",
    );
  }

  const kind: ProphitBetKind = isResult ? "result" : "goals_2_5";
  const warnings: ProphitBetWarning[] = [];
  const predictions: ProphitBetPrediction[] = [];

  for (const row of rows.slice(1)) {
    const fail = (reason: string) =>
      warnings.push({ sourceFile, line: row.line, reason });
    if (row.cells.length !== headers.length) {
      fail("Numero di colonne non coerente: non mescolare esportazioni diverse nello stesso CSV.");
      continue;
    }
    const cell = (name: string) => row.cells[header(name)]?.trim() ?? "";
    const homeTeam = cell("Home Team");
    const awayTeam = cell("Away Team");
    if (
      !homeTeam || !awayTeam || homeTeam.length > MAX_TEAM_LENGTH ||
      awayTeam.length > MAX_TEAM_LENGTH ||
      normalizeProphitBetTeam(homeTeam) === normalizeProphitBetTeam(awayTeam)
    ) {
      fail("Squadre mancanti, identiche o troppo lunghe.");
      continue;
    }

    const predicted = cell("Predicted").toUpperCase();
    if (!((kind === "result" && ["H", "D", "A"].includes(predicted)) ||
          (kind === "goals_2_5" && ["U", "O"].includes(predicted)))) {
      fail("Etichetta Predicted non valida.");
      continue;
    }

    if (kind === "result") {
      const home = probability(cell("Prob(1)"));
      const draw = probability(cell("Prob(X)"));
      const away = probability(cell("Prob(2)"));
      if (home === null || draw === null || away === null || !nearOne([home, draw, away])) {
        fail("Probabilita' 1/X/2 mancanti, fuori 0..1 o che non sommano a circa 100%.");
        continue;
      }
      predictions.push({
        fixtureDate, homeTeam, awayTeam, kind, sourceFile, predicted,
        probabilities: { home, draw, away },
      });
    } else {
      const under25 = probability(cell("Prob(U)"));
      const over25 = probability(cell("Prob(O)"));
      if (under25 === null || over25 === null || !nearOne([under25, over25])) {
        fail("Probabilita' U/O 2.5 mancanti o non valide.");
        continue;
      }
      predictions.push({
        fixtureDate, homeTeam, awayTeam, kind, sourceFile, predicted,
        probabilities: { under25, over25 },
      });
    }
  }

  return { predictions, warnings };
}

function asPick(
  prediction: ProphitBetPrediction,
  market: ProphitBetMarket,
  p: number,
): ProphitBetPick | null {
  if (!Number.isFinite(p) || p <= 0 || p > 1.025) return null;
  const clean = Math.max(0, Math.min(1, p));
  if (clean <= 0) return null;
  return {
    fixtureKey: prophitBetFixtureKey(prediction),
    fixtureDate: prediction.fixtureDate,
    homeTeam: prediction.homeTeam,
    awayTeam: prediction.awayTeam,
    market,
    probability: Math.round(clean * 10000) / 10000,
    fairOdds: Math.round((1 / clean) * 100) / 100,
    sourceFile: prediction.sourceFile,
  };
}

/**
 * Independent probabilities for result markets are summed; Under/Over 2.5
 * probabilities are imported directly. Model estimates are NEVER real odds.
 */
export function buildProphitBetPicks(predictions: ProphitBetPrediction[]): ProphitBetPick[] {
  const picks: ProphitBetPick[] = [];
  for (const p of predictions) {
    if (p.kind === "result") {
      const home = p.probabilities.home;
      const draw = p.probabilities.draw;
      const away = p.probabilities.away;
      if (home === undefined || draw === undefined || away === undefined) continue;
      for (const [market, prob] of [
        ["1", home], ["X", draw], ["2", away],
        ["1X", home + draw], ["X2", draw + away], ["12", home + away],
      ] as const) {
        const candidate = asPick(p, market, prob);
        if (candidate) picks.push(candidate);
      }
    } else {
      const under = p.probabilities.under25;
      const over = p.probabilities.over25;
      if (under === undefined || over === undefined) continue;
      const u = asPick(p, "UNDER_2_5", under);
      const o = asPick(p, "OVER_2_5", over);
      if (u) picks.push(u);
      if (o) picks.push(o);
    }
  }
  return picks.sort(
    (a, b) =>
      b.probability - a.probability ||
      a.fixtureDate.localeCompare(b.fixtureDate) ||
      a.fixtureKey.localeCompare(b.fixtureKey) ||
      a.market.localeCompare(b.market),
  );
}

const SUGGESTION_MARKETS = new Set<ProphitBetMarket>([
  "1X", "X2", "12", "UNDER_2_5", "OVER_2_5",
]);

/**
 * Pick two DIFFERENT matches, and only when theoretical fair odds fall in
 * 1.70..2.00. This is NOT a bookmaker-odds or positive-EV recommendation.
 */
export function buildProphitBetDouble(picks: ProphitBetPick[]): ProphitBetDouble | null {
  const eligible = picks.filter(
    (p) => SUGGESTION_MARKETS.has(p.market) &&
      Number.isFinite(p.probability) &&
      p.probability >= MIN_SUGGESTION_PROBABILITY &&
      p.probability <= 1,
  ).slice(0, 200);

  let best: ProphitBetDouble | null = null;
  for (let i = 0; i < eligible.length; i += 1) {
    for (let j = i + 1; j < eligible.length; j += 1) {
      const a = eligible[i];
      const b = eligible[j];
      if (a.fixtureKey === b.fixtureKey) continue;
      const combinedProbability = a.probability * b.probability;
      const combinedFairOdds = 1 / combinedProbability;
      if (
        combinedFairOdds < TARGET_FAIR_ODDS_MIN ||
        combinedFairOdds > TARGET_FAIR_ODDS_MAX
      ) continue;
      if (!best || combinedProbability > best.combinedProbability) {
        best = {
          picks: [a, b],
          combinedProbability: Math.round(combinedProbability * 10000) / 10000,
          combinedFairOdds: Math.round(combinedFairOdds * 100) / 100,
        };
      }
    }
  }
  return best;
}
