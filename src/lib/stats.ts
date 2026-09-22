// ============================================================
// Funzioni pure per il calcolo delle statistiche di betting.
// Nessuna dipendenza da Supabase: lavorano su array in memoria.
// ============================================================

import type { Bet, Match } from "@/types";

export interface BetStats {
  totalBets: number;
  won: number;
  lost: number;
  voids: number;
  open: number;
  totalStaked: number;
  totalProfit: number;
  roi: number; // % sul totale giocato
  winRate: number; // % sulle giocate decise (won / (won+lost))
  avgOdds: number;
  avgEv: number; // media EV in forma decimale
  avgClv: number | null; // % medio di Closing Line Value (null se nessun closing)
  maxDrawdown: number; // valore assoluto in €
  maxDrawdownPct: number; // % sul picco
}

export interface EquityPoint {
  index: number;
  date: string;
  profit: number; // profitto cumulato
  bankroll: number; // bankroll = bankroll iniziale + profitto cumulato
}

export interface GroupStat {
  key: string;
  bets: number;
  staked: number;
  profit: number;
  roi: number;
  winRate: number;
}

const settled = (b: Bet) => b.status !== "open";

/** Curva di equity ordinata per data di chiusura. */
export function computeEquity(bets: Bet[], startBankroll = 0): EquityPoint[] {
  const closed = bets
    .filter(settled)
    .sort((a, b) =>
      (a.settledAt ?? a.createdAt).localeCompare(b.settledAt ?? b.createdAt)
    );

  let cum = 0;
  const points: EquityPoint[] = [
    { index: 0, date: "", profit: 0, bankroll: startBankroll },
  ];

  closed.forEach((b, i) => {
    cum += b.profit;
    points.push({
      index: i + 1,
      date: b.settledAt ?? b.createdAt,
      profit: cum,
      bankroll: startBankroll + cum,
    });
  });

  return points;
}

export function computeDrawdown(
  points: EquityPoint[]
): { amount: number; pct: number } {
  if (points.length === 0) return { amount: 0, pct: 0 };
  let peak = points[0].bankroll;
  let maxAmount = 0;
  let maxPct = 0;

  for (const p of points) {
    if (p.bankroll > peak) peak = p.bankroll;
    const dd = peak - p.bankroll;
    if (dd > maxAmount) maxAmount = dd;
    if (peak > 0) {
      const pct = (dd / peak) * 100;
      if (pct > maxPct) maxPct = pct;
    }
  }

  return { amount: maxAmount, pct: maxPct };
}

/** Statistiche complessive sulle giocate chiuse. */
export function computeStats(bets: Bet[], startBankroll = 0): BetStats {
  const closed = bets.filter(settled);
  const won = closed.filter((b) => b.status === "won").length;
  const lost = closed.filter((b) => b.status === "lost").length;
  const voids = closed.filter((b) => b.status === "void").length;
  const open = bets.length - closed.length;

  const totalStaked = closed.reduce((s, b) => s + b.stake, 0);
  const totalProfit = closed.reduce((s, b) => s + b.profit, 0);
  const roi = totalStaked > 0 ? (totalProfit / totalStaked) * 100 : 0;
  const decided = won + lost;
  const winRate = decided > 0 ? (won / decided) * 100 : 0;

  const avgOdds = closed.length
    ? closed.reduce((s, b) => s + b.odds, 0) / closed.length
    : 0;
  const avgEv = closed.length
    ? closed.reduce((s, b) => s + b.ev, 0) / closed.length
    : 0;

  const withClv = closed.filter((b) => b.closingOdds != null);
  const avgClv = withClv.length
    ? (withClv.reduce((s, b) => s + (b.odds / (b.closingOdds as number) - 1), 0) /
        withClv.length) *
      100
    : null;

  const equity = computeEquity(bets, startBankroll);
  const dd = computeDrawdown(equity);

  return {
    totalBets: bets.length,
    won,
    lost,
    voids,
    open,
    totalStaked,
    totalProfit,
    roi,
    winRate,
    avgOdds,
    avgEv,
    avgClv,
    maxDrawdown: dd.amount,
    maxDrawdownPct: dd.pct,
  };
}

/** Fascia di quota di una giocata. */
export function oddsBracket(odds: number): string {
  if (odds < 1.5) return "< 1.50";
  if (odds < 2.0) return "1.50 – 1.99";
  if (odds < 2.5) return "2.00 – 2.49";
  if (odds < 3.0) return "2.50 – 2.99";
  return "≥ 3.00";
}

/**
 * Raggruppa le giocate chiuse per una chiave arbitraria
 * (campionato, mercato, fascia quota...) e calcola P/L, ROI e win rate.
 */
export function groupBets(
  bets: Bet[],
  matches: Match[],
  keyOf: (bet: Bet, match?: Match) => string
): GroupStat[] {
  const matchById = new Map(matches.map((m) => [m.id, m]));

  const map = new Map<
    string,
    { staked: number; profit: number; won: number; lost: number; count: number }
  >();

  for (const b of bets) {
    if (!settled(b)) continue;
    const m = matchById.get(b.matchId);
    const key = keyOf(b, m) || "Altro";
    const g = map.get(key) ?? { staked: 0, profit: 0, won: 0, lost: 0, count: 0 };
    g.staked += b.stake;
    g.profit += b.profit;
    g.count += 1;
    if (b.status === "won") g.won += 1;
    if (b.status === "lost") g.lost += 1;
    map.set(key, g);
  }

  return [...map.entries()]
    .map(([key, g]) => ({
      key,
      bets: g.count,
      staked: g.staked,
      profit: g.profit,
      roi: g.staked > 0 ? (g.profit / g.staked) * 100 : 0,
      winRate: g.won + g.lost > 0 ? (g.won / (g.won + g.lost)) * 100 : 0,
    }))
    .sort((a, b) => b.profit - a.profit);
}
