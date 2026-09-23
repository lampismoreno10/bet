// ============================================================
// Client DeepSeek — SOLO SERVER-SIDE.
//
// ⚠️ `DEEPSEEK_API_KEY` NON deve avere prefisso NEXT_PUBLIC_ e questo
// modulo non deve essere importato da Client Component.
//
// DeepSeek produce una RACCOMANDAZIONE (mercato, selezione, probabilità,
// affidabilità, motivazioni). NON produce quote: bookmakerOdds ed EV
// vengono calcolati dal sistema a partire dalle quote REALI di API-Football,
// e scartati se la quota reale non esiste.
// ============================================================

import { allowedMarketList } from "@/lib/sports/markets";
import type { FixtureOdds, FixturePrediction } from "@/lib/sports/api-football";
import type { StandingRow, TeamStatistics } from "@/lib/sports/openfootball";

export interface DeepSeekAnalysis {
  market: string;
  selection: string;
  estimatedProbability: number; // 0..1 — stima prudente del modello
  confidence: number; // 0..100
  reasons: string[]; // quali dati concreti supportano la probabilità
  risks: string[]; // elementi che la rendono poco affidabile
}

/** Fonte del contesto statistico usata per questa partita. */
export type StatsSource = "openfootball" | "api-football-prediction" | null;

export interface MatchContext {
  homeTeam: string;
  awayTeam: string;
  competition: string;
  kickoffAt: string;
  statsSource: StatsSource;
  homeStats: TeamStatistics | null;
  awayStats: TeamStatistics | null;
  standings: StandingRow[] | null;
  /** Stima di terze parti: MAI presentata come fatto certo. */
  prediction: FixturePrediction | null;
  /** Quote reali, solo mercati ammessi. */
  odds: FixtureOdds | null;
}

export function isDeepSeekConfigured(): boolean {
  return Boolean(process.env.DEEPSEEK_API_KEY);
}

const MARKET_LIST = allowedMarketList()
  .map((m) => `  - mercato "${m.market}", selezione "${m.selection}"   (${m.label})`)
  .join("\n");

const SYSTEM_PROMPT = `Sei un analista professionista di scommesse sportive (calcio).
Ti viene fornito il contesto di una partita e le QUOTE REALI disponibili.
Devi produrre UNA SOLA raccomandazione, scegliendo ESCLUSIVAMENTE tra i mercati supportati.

MERCATI SUPPORTATI (valori ammessi di "market" e "selection"):
${MARKET_LIST}

Rispondi ESCLUSIVAMENTE con un oggetto JSON valido, senza testo introduttivo, senza markdown.

ESEMPIO DI OUTPUT JSON VALIDO:
{
  "market": "Over/Under 2.5",
  "selection": "Over 2.5",
  "estimatedProbability": 0.57,
  "confidence": 68,
  "reasons": ["dato statistico coerente con la selezione"],
  "risks": ["campione limitato"]
}

COSA NON DEVI PRODURRE:
- NON inserire alcun campo "state", "bookmakerOdds", "ev" o "fairOdds". La decisione finale (giocabile / scartata / da_valutare), la quota equa e l'EV sono calcolati dal SISTEMA a partire dalle quote REALI. La tua opinione sullo stato non viene usata.

Regole:
- NON inventare dati mancanti: se un'informazione non è disponibile, non citarla oppure indica esplicitamente che manca.
- Sii PRUDENTE: non alzare "estimatedProbability" solo perché API-Football indica una squadra favorita. Una probabilità gonfiata rispetto alla quota reale produce un EV falso e fa scartare l'analisi.
- In "reasons" indica QUALI DATI CONCRETI sostengono la probabilità (forma, gol fatti/subiti, casa/trasferta, Over/BTTS, classifica, quote).
- In "risks" indica cosa può renderla POCO AFFIDABILE (dati parziali o assenti, campione ridotto, stima esterna, mercato instabile, assenze non note).
- Se la tua stima è molto più alta di quanto implica la quota del bookmaker, ABBASSA "confidence" e spiegalo nei "risks".
- Scegli il mercato SOLO tra quelli supportati e SOLO se nella sezione QUOTE compare la quota reale corrispondente.
- Se per nessun mercato supportato esiste una quota reale, indica comunque il mercato con la probabilità più difendibile, con "confidence" <= 50.
- Il contesto marcato come "stima di terze parti" NON è un fatto certo: API-Football prediction è una stima esterna, NON una statistica indipendente verificata. Trattala come indizio debole e non farci salire la probabilità.
- "estimatedProbability" deve essere un numero compreso tra 0 e 1.
- NON sei obbligato a trovare valore: è normale e frequente che una partita non sia giocabile. Il sistema applica soglie minime di EV e affidabilità e scarterà ciò che non le raggiunge.
- Rispondi SOLO con il JSON.`;

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string").slice(0, 6);
}

/** Estrae il JSON dalla risposta, tollerando eventuali ```json ```. */
function extractJson(content: string): Record<string, unknown> | null {
  const trimmed = content.trim();
  try {
    const direct = JSON.parse(trimmed);
    if (direct && typeof direct === "object") return direct;
  } catch {
    // continua
  }

  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) {
    try {
      const parsed = JSON.parse(fence[1].trim());
      if (parsed && typeof parsed === "object") return parsed;
    } catch {
      // continua
    }
  }

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      const parsed = JSON.parse(trimmed.slice(start, end + 1));
      if (parsed && typeof parsed === "object") return parsed;
    } catch {
      // continua
    }
  }

  return null;
}

/**
 * Valida e normalizza la risposta del modello.
 *
 * NON legge alcuna quota dalla risposta: `bookmakerOdds` ed `ev` non
 * esistono più in questo tipo. La quota equa dipende solo dalla probabilità
 * stimata. La verifica della quota REALE avviene nel chiamante.
 */
function parseAnalysis(json: Record<string, unknown>): DeepSeekAnalysis | null {
  const market = typeof json.market === "string" ? json.market.trim() : "";
  const selection = typeof json.selection === "string" ? json.selection.trim() : "";
  if (!market && !selection) return null;

  const probability = clamp(Number(json.estimatedProbability), 0, 1);

  return {
    market,
    selection,
    estimatedProbability: probability,
    confidence: Math.round(clamp(Number(json.confidence), 0, 100)),
    reasons: asStringArray(json.reasons),
    risks: asStringArray(json.risks),
  };
}

function fmtStats(label: string, s: TeamStatistics | null): string {
  if (!s) return `${label}: dati non disponibili`;
  const parts: string[] = [];
  if (s.form) parts.push(`forma ${s.form}`);
  if (s.wins != null) parts.push(`${s.wins}V-${s.draws ?? 0}N-${s.losses ?? 0}P`);
  if (s.played != null) parts.push(`${s.played} giocate`);
  if (s.points != null) parts.push(`${s.points} pt`);
  if (s.rank != null) parts.push(`posizione ${s.rank}`);
  if (s.goalDifference != null) {
    parts.push(`differenza reti ${s.goalDifference > 0 ? "+" : ""}${s.goalDifference}`);
  }
  if (s.goalsFor != null) parts.push(`gol fatti ${s.goalsFor}`);
  if (s.goalsAgainst != null) parts.push(`gol subiti ${s.goalsAgainst}`);
  if (s.avgGoalsFor != null) parts.push(`media gol fatti ${s.avgGoalsFor.toFixed(2)}`);
  if (s.avgGoalsAgainst != null) {
    parts.push(`media gol subiti ${s.avgGoalsAgainst.toFixed(2)}`);
  }
  if (s.homeForm) parts.push(`forma casa ${s.homeForm}`);
  if (s.awayForm) parts.push(`forma trasferta ${s.awayForm}`);
  return `${label}: ${parts.length ? parts.join(", ") : "dati non disponibili"}`;
}

function fmtPercentages(label: string, s: TeamStatistics | null): string | null {
  if (!s) return null;
  const parts: string[] = [];
  if (s.over15 != null) parts.push(`Over 1.5 ${Math.round(s.over15 * 100)}%`);
  if (s.over25 != null) parts.push(`Over 2.5 ${Math.round(s.over25 * 100)}%`);
  if (s.under45 != null) parts.push(`Under 4.5 ${Math.round(s.under45 * 100)}%`);
  if (s.btts != null) parts.push(`entrambe segnano ${Math.round(s.btts * 100)}%`);
  return parts.length > 0 ? `${label}: ${parts.join(", ")}` : null;
}

function fmtLast5(label: string, s: TeamStatistics | null): string | null {
  if (!s?.last5 || s.last5.length === 0) return null;
  return `${label}: ${s.last5.join("; ")}`;
}

/**
 * Sezione QUOTE: elenca, per ogni quota reale disponibile, la coppia
 * market/selezione che il modello deve usare. Così la scelta del modello è
 * verificabile contro il dato reale.
 */
function fmtOdds(odds: FixtureOdds | null): string[] {
  if (!odds || odds.quotes.length === 0) {
    return ["- nessuna quota reale disponibile: indica comunque il mercato con la probabilità più difendibile, con \"confidence\" <= 50. Lo stato lo decide il sistema."];
  }
  const lines = [`- Bookmaker: ${odds.bookmaker}`];
  for (const q of odds.quotes) {
    lines.push(`- ${q.label} @ ${q.odd.toFixed(2)}`);
  }
  return lines;
}

/** Contesto di fallback: SEMPRE etichettato come stima di terze parti. */
function fmtPrediction(p: FixturePrediction | null): string[] {
  if (!p) return [];
  const lines: string[] = [];
  if (p.winner) lines.push(`- Esito previsto: ${p.winner}`);
  if (p.winOrDraw) lines.push("- Previsione con possibile pareggio");
  if (p.underOver) lines.push(`- Under/Over previsto: ${p.underOver}`);
  if (p.advice) lines.push(`- Consiglio: ${p.advice}`);
  if (p.percentHome || p.percentDraw || p.percentAway) {
    lines.push(
      `- Probabilità stimate: casa ${p.percentHome ?? "?"}, pareggio ${
        p.percentDraw ?? "?"
      }, ospiti ${p.percentAway ?? "?"}`
    );
  }
  if (p.goalsHome || p.goalsAway) {
    lines.push(`- Gol attesi: ${p.goalsHome ?? "?"} - ${p.goalsAway ?? "?"}`);
  }
  return lines;
}

export function buildContextText(ctx: MatchContext): string {
  const lines: string[] = [
    `PARTITA: ${ctx.homeTeam} vs ${ctx.awayTeam}`,
    `Campionato: ${ctx.competition}`,
    `Calcio d'inizio: ${ctx.kickoffAt}`,
    `Fonte statistica: ${
      ctx.statsSource === "openfootball"
        ? "OpenFootball (risultati ufficiali della stagione)"
        : ctx.statsSource === "api-football-prediction"
          ? "nessun dataset stagionale: solo stima di terze parti (API-Football)"
          : "nessuna"
    }`,
  ];

  if (ctx.homeStats || ctx.awayStats) {
    lines.push(
      "",
      "FORMA SQUADRE",
      fmtStats(`- ${ctx.homeTeam}`, ctx.homeStats),
      fmtStats(`- ${ctx.awayTeam}`, ctx.awayStats)
    );

    const percentages = [
      fmtPercentages(`- ${ctx.homeTeam}`, ctx.homeStats),
      fmtPercentages(`- ${ctx.awayTeam}`, ctx.awayStats),
    ].filter((line): line is string => line !== null);
    if (percentages.length > 0) {
      lines.push("", "PERCENTUALI SUI RISULTATI (stagione)", ...percentages);
    }

    const last5 = [
      fmtLast5(`- ${ctx.homeTeam}`, ctx.homeStats),
      fmtLast5(`- ${ctx.awayTeam}`, ctx.awayStats),
    ].filter((line): line is string => line !== null);
    if (last5.length > 0) {
      lines.push("", "ULTIME 5 PARTITE", ...last5);
    }

    lines.push("", "CLASSIFICA");
    if (ctx.standings && ctx.standings.length > 0) {
      const relevant = ctx.standings.filter(
        (r) => r.team === ctx.homeTeam || r.team === ctx.awayTeam
      );
      const shown = relevant.length > 0 ? relevant : ctx.standings.slice(0, 6);
      for (const r of shown) {
        const played = r.played != null ? `, ${r.played} g` : "";
        const diff =
          r.goalDifference != null
            ? `, differenza reti ${r.goalDifference > 0 ? "+" : ""}${r.goalDifference}`
            : "";
        lines.push(`- #${r.rank} ${r.team} (${r.points} pt${played}${diff})`);
      }
    } else {
      lines.push("- non disponibile");
    }
  }

  const prediction = fmtPrediction(ctx.prediction);
  if (prediction.length > 0) {
    lines.push(
      "",
      "CONTESTO API-FOOTBALL (STIMA DI TERZE PARTI — NON è un fatto certo)",
      ...prediction
    );
  } else if (!ctx.homeStats && !ctx.awayStats) {
    lines.push("", "CONTESTO", "- nessuna statistica disponibile per questa partita");
  }

  lines.push("", "QUOTE REALI DISPONIBILI", ...fmtOdds(ctx.odds));

  return lines.join("\n");
}

/** Chiama DeepSeek e restituisce l'analisi validata, oppure null. */
export async function analyzeMatchWithDeepSeek(
  ctx: MatchContext
): Promise<DeepSeekAnalysis | null> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) return null;

  const userPrompt = buildContextText(ctx);

  let response: Response;
  try {
    response = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "deepseek-flash",
        thinking: { type: "disabled" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
        response_format: { type: "json_object" },
        temperature: 0.2,
        max_tokens: 1200,
      }),
      cache: "no-store",
    });
  } catch {
    return null;
  }

  if (!response.ok) {
    let detail = "";
    try {
      const errorBody = (await response.json()) as {
        error?: { message?: unknown };
        message?: unknown;
      };
      const raw = errorBody?.error?.message ?? errorBody?.message;
      if (typeof raw === "string") detail = raw.slice(0, 300);
    } catch {
      // Il solo status HTTP e' gia' sufficiente per la diagnostica.
    }
    throw new Error(
      `DeepSeek HTTP ${response.status}${detail ? `: ${detail}` : ""}`
    );
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    return null;
  }

  const choice = (
    data as {
      choices?: {
        finish_reason?: unknown;
        message?: { content?: unknown };
      }[];
    } | null
  )?.choices?.[0];

  const content = choice?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error(
      `DeepSeek ha restituito content vuoto (finish_reason=${String(
        choice?.finish_reason ?? "unknown"
      )})`
    );
  }

  const json = extractJson(content);
  if (!json) {
    throw new Error("DeepSeek ha restituito contenuto non interpretabile come JSON.");
  }

  const parsed = parseAnalysis(json);
  if (!parsed) {
    throw new Error("DeepSeek ha restituito JSON senza market/selection validi.");
  }

  return parsed;
}
