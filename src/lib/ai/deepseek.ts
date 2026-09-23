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
  /** Quota bookmaker REALE. null se nessuna fonte la fornisce. */
  bookmakerOdds: number | null;
  /** EV = p × quota − 1. null quando bookmakerOdds manca: non calcolabile. */
  ev: number | null;
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
  "bookmakerOdds": number|null, // quota REALE se disponibile, altrimenti null (MAI stimata)
  "ev": number|null,         // p × bookmakerOdds - 1; null se bookmakerOdds è null
  "confidence": number,      // affidabilità 0..100
  "state": string,           // "da_valutare" | "giocabile" | "scartata"
  "reasons": string[],       // motivazioni brevi
  "risks": string[]          // rischi e controindicazioni
}

Regole:
- NON inventare dati mancanti: se un'informazione non è disponibile, non citarla oppure indica esplicitamente che manca.
- Se i dati sono insufficienti, usa state "da_valutare" e confidence bassa (<=50).
- Se nella sezione QUOTE non sono disponibili quote reali, imposta "bookmakerOdds": null e "ev": null. NON stimare, NON approssimare e NON fornire una quota "ipotetica" in alcun campo. "fairOdds" resta calcolabile da "estimatedProbability". In questo caso "state" deve essere "da_valutare" e "confidence" <= 50.
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

/**
 * Quota valida (> 1) oppure null.
 * NON si fabbrica mai una quota: se non c'è una quota reale, resta assente.
 */
function asOdds(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 1 ? n : null;
}

/** Valida e normalizza l'oggetto JSON restituito da DeepSeek. */
function parseAnalysis(json: Record<string, unknown>): DeepSeekAnalysis | null {
  const market = typeof json.market === "string" ? json.market.trim() : "";
  const selection = typeof json.selection === "string" ? json.selection.trim() : "";
  if (!market && !selection) return null;

  const probability = clamp(Number(json.estimatedProbability), 0, 1);
  const fairOdds = probability > 0
    ? Number((1 / probability).toFixed(2))
    : Number(json.fairOdds) || 0;

  // Senza una quota REALE non esiste EV: entrambi restano null.
  const bookmakerOdds = asOdds(json.bookmakerOdds);
  const ev =
    bookmakerOdds != null && probability > 0
      ? Number((probability * bookmakerOdds - 1).toFixed(4))
      : null;

  // Regola tassativa applicata nel CODICE, non solo nel prompt: quando la
  // quota reale manca, la partita resta "da valutare" con confidence <= 50.
  const rawConfidence = Math.round(clamp(Number(json.confidence), 0, 100));
  const state: AnalysisState =
    bookmakerOdds != null ? normalizeState(json.state) : "da_valutare";
  const confidence =
    bookmakerOdds != null ? rawConfidence : Math.min(rawConfidence, 50);

  return {
    market,
    selection,
    estimatedProbability: probability,
    fairOdds,
    bookmakerOdds,
    ev,
    confidence,
    state,
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

/**
 * Percentuali sui risultati, su tutte le partite giocate.
 * Restituisce null quando la fonte non le fornisce: niente righe inventate.
 */
function fmtPercentages(label: string, s: TeamStatistics | null): string | null {
  if (!s) return null;
  const parts: string[] = [];
  if (s.over15 != null) parts.push(`Over 1.5 ${Math.round(s.over15 * 100)}%`);
  if (s.over25 != null) parts.push(`Over 2.5 ${Math.round(s.over25 * 100)}%`);
  if (s.under45 != null) parts.push(`Under 4.5 ${Math.round(s.under45 * 100)}%`);
  if (s.btts != null) parts.push(`entrambe segnano ${Math.round(s.btts * 100)}%`);
  return parts.length > 0 ? `${label}: ${parts.join(", ")}` : null;
}

/** Ultime 5 partite giocate, già formattate dalla fonte. */
function fmtLast5(label: string, s: TeamStatistics | null): string | null {
  if (!s?.last5 || s.last5.length === 0) return null;
  return `${label}: ${s.last5.join("; ")}`;
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
  ];

  // Sezioni opzionali: compaiono solo se la fonte fornisce davvero i dati.
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

  lines.push("", "PRECEDENTI (H2H)");

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
