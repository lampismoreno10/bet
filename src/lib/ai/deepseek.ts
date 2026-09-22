// ============================================================
// Client DeepSeek — SOLO SERVER-SIDE.
//
// ⚠️ `DEEPSEEK_API_KEY` NON deve avere prefisso NEXT_PUBLIC_ e questo
// modulo non deve essere importato da Client Component.
//
// DeepSeek espone un'API compatibile con OpenAI (chat completions).
// Chiediamo JSON strutturato (response_format json_object) e poi
// validiamo/clampiamo il risultato prima di salvarlo.
// ============================================================

import type { AnalysisState } from "@/types";
import type {
  FixtureOdds,
  HeadToHeadMatch,
  InjuryInfo,
  StandingRow,
  TeamStatistics,
} from "@/lib/sports/api-football";

const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";
const DEEPSEEK_MODEL = "deepseek-chat";

export interface DeepSeekAnalysis {
  market: string;
  selection: string;
  estimatedProbability: number;
  fairOdds: number;
  bookmakerOdds: number;
  ev: number;
  confidence: number;
  state: AnalysisState;
  reasons: string[];
  risks: string[];
}

export interface MatchContext {
  homeTeam: string;
  awayTeam: string;
  competition: string;
  kickoffAt: string;
  homeStats: TeamStatistics | null;
  awayStats: TeamStatistics | null;
  h2h: HeadToHeadMatch[] | null;
  standings: StandingRow[] | null;
  homeInjuries: InjuryInfo[] | null;
  awayInjuries: InjuryInfo[] | null;
  odds: FixtureOdds | null;
}

export function isDeepSeekConfigured(): boolean {
  return Boolean(process.env.DEEPSEEK_API_KEY);
}

const SYSTEM_PROMPT = `Sei un analista professionista di scommesse sportive (calcio).
Ti viene fornito il contesto di una partita e una serie di dati. Devi produrre UNA SOLA raccomandazione di mercato.

Rispondi ESCLUSIVAMENTE con un oggetto JSON valido, senza testo introduttivo, senza markdown, con esattamente questa struttura:

{
  "market": string,          // uno tra: "1X", "X2", "12", "Over/Under 1.5", "Over/Under 2.5", "Under 4.5", "Multigol", "Corner", "Cartellini"
  "selection": string,       // es. "1", "X2", "Over 1.5", "Under 2.5", "1-3 gol"
  "estimatedProbability": number, // probabilità stimata 0..1 (es. 0.55)
  "fairOdds": number,        // quota equa = 1 / probabilità
  "bookmakerOdds": number,   // quota disponibile se presente, altrimenti stima conservativa
  "ev": number,              // expected value in forma decimale (es. 0.05)
  "confidence": number,      // affidabilità 0..100
  "state": string,           // "da_valutare" | "giocabile" | "scartata"
  "reasons": string[],       // motivazioni brevi
  "risks": string[]          // rischi e controindicazioni
}

Regole:
- NON inventare dati mancanti: se un'informazione non è disponibile, non citarla oppure indica esplicitamente che manca.
- Se i dati sono insufficienti, usa state "da_valutare" e confidence bassa (<=50).
- "giocabile" solo se c'è un valore chiaro (EV positivo) e dati sufficienti.
- "scartata" se il valore è negativo o il rischio è troppo alto.
- "estimatedProbability" deve essere un numero compreso tra 0 e 1.
- Rispondi SOLO con il JSON.`;

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string").slice(0, 6);
}

function normalizeState(v: unknown): AnalysisState {
  if (v === "giocabile" || v === "scartata" || v === "da_valutare") return v;
  return "da_valutare";
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

/** Valida e normalizza l'oggetto JSON restituito da DeepSeek. */
function parseAnalysis(json: Record<string, unknown>): DeepSeekAnalysis | null {
  const market = typeof json.market === "string" ? json.market.trim() : "";
  const selection = typeof json.selection === "string" ? json.selection.trim() : "";
  if (!market && !selection) return null;

  const probability = clamp(Number(json.estimatedProbability), 0, 1);
  const bookmakerOdds = Math.max(1.01, Number(json.bookmakerOdds) || 0);
  const fairOdds = probability > 0 ? Number((1 / probability).toFixed(2)) : Number(json.fairOdds) || 0;
  const ev = probability > 0 && bookmakerOdds > 0
    ? Number((probability * bookmakerOdds - 1).toFixed(4))
    : Number(json.ev) || 0;

  return {
    market,
    selection,
    estimatedProbability: probability,
    fairOdds,
    bookmakerOdds,
    ev,
    confidence: Math.round(clamp(Number(json.confidence), 0, 100)),
    state: normalizeState(json.state),
    reasons: asStringArray(json.reasons),
    risks: asStringArray(json.risks),
  };
}

function fmtStats(label: string, s: TeamStatistics | null): string {
  if (!s) return `${label}: dati non disponibili`;
  const parts: string[] = [];
  if (s.form) parts.push(`forma ${s.form}`);
  if (s.wins != null) parts.push(`${s.wins}V-${s.draws ?? 0}N-${s.losses ?? 0}P`);
  if (s.goalsFor != null) parts.push(`gol fatti ${s.goalsFor}`);
  if (s.goalsAgainst != null) parts.push(`gol subiti ${s.goalsAgainst}`);
  return `${label}: ${parts.length ? parts.join(", ") : "dati non disponibili"}`;
}

export function buildContextText(ctx: MatchContext): string {
  const lines: string[] = [
    `PARTITA: ${ctx.homeTeam} vs ${ctx.awayTeam}`,
    `Campionato: ${ctx.competition}`,
    `Calcio d'inizio: ${ctx.kickoffAt}`,
    "",
    "FORMA SQUADRE",
    fmtStats(`- ${ctx.homeTeam}`, ctx.homeStats),
    fmtStats(`- ${ctx.awayTeam}`, ctx.awayStats),
    "",
    "PRECEDENTI (H2H)",
  ];

  if (ctx.h2h && ctx.h2h.length > 0) {
    for (const h of ctx.h2h) {
      lines.push(`- ${h.homeTeam} ${h.homeGoals ?? "-"} - ${h.awayGoals ?? "-"} ${h.awayTeam} (${h.date.slice(0, 10)})`);
    }
  } else {
    lines.push("- non disponibili");
  }

  lines.push("", "CLASSIFICA");
  if (ctx.standings && ctx.standings.length > 0) {
    const relevant = ctx.standings.filter(
      (r) => r.team === ctx.homeTeam || r.team === ctx.awayTeam
    );
    const shown = relevant.length > 0 ? relevant : ctx.standings.slice(0, 6);
    for (const r of shown) {
      lines.push(`- #${r.rank} ${r.team} (${r.points} pt)`);
    }
  } else {
    lines.push("- non disponibile");
  }

  lines.push("", "INFORTUNI / ASSENZE");
  if (ctx.homeInjuries && ctx.homeInjuries.length > 0) {
    lines.push(`- ${ctx.homeTeam}: ${ctx.homeInjuries.map((i) => `${i.player} (${i.reason || i.type})`).join("; ")}`);
  } else {
    lines.push(`- ${ctx.homeTeam}: nessuno segnalato o dato non disponibile`);
  }
  if (ctx.awayInjuries && ctx.awayInjuries.length > 0) {
    lines.push(`- ${ctx.awayTeam}: ${ctx.awayInjuries.map((i) => `${i.player} (${i.reason || i.type})`).join("; ")}`);
  } else {
    lines.push(`- ${ctx.awayTeam}: nessuno segnalato o dato non disponibile`);
  }

  lines.push("", "QUOTE");
  if (ctx.odds) {
    lines.push(`- Bookmaker: ${ctx.odds.bookmaker}`);
    for (const m of ctx.odds.markets) {
      lines.push(`- ${m.name}: ${m.values.map((v) => `${v.value}@${v.odd}`).join(", ")}`);
    }
  } else {
    lines.push("- non disponibili (non inventarle)");
  }

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
    response = await fetch(DEEPSEEK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: DEEPSEEK_MODEL,
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

  if (!response.ok) return null;

  let data: any;
  try {
    data = await response.json();
  } catch {
    return null;
  }

  const content: unknown = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string") return null;

  const json = extractJson(content);
  if (!json) return null;

  return parseAnalysis(json);
}
