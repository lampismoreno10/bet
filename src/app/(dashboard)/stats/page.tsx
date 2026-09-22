import { EquityChart } from "@/components/equity-chart";
import { GroupTable } from "@/components/group-table";
import { StatCard } from "@/components/stat-card";
import {
  computeBankroll,
  getBankrollTransactions,
  getBets,
} from "@/lib/data";
import { formatPercent, formatSignedEuro } from "@/lib/format";
import {
  computeDrawdown,
  computeEquity,
  computeStats,
  groupBets,
  oddsBracket,
} from "@/lib/stats";

export const dynamic = "force-dynamic";

export default async function StatsPage() {
  const [records, transactions] = await Promise.all([
    getBets(),
    getBankrollTransactions(),
  ]);

  const bets = records.map((r) => r.bet);
  const matches = [...new Map(records.map((r) => [r.match.id, r.match])).values()];

  const bankroll = computeBankroll(transactions);
  const stats = computeStats(bets, bankroll);

  const byCompetition = groupBets(bets, matches, (b, m) => m?.competition ?? "—");
  const byMarket = groupBets(bets, matches, (b) => b.market);
  const byOdds = groupBets(bets, matches, (b) => oddsBracket(b.odds));

  const equity = computeEquity(bets, bankroll);
  const drawdown = computeDrawdown(equity);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-100">
          Statistiche
        </h1>
        <p className="text-sm text-zinc-500">
          Performance, drawdown e analisi per campionato, mercato e quota
        </p>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard
          label="Profitto"
          value={formatSignedEuro(stats.totalProfit)}
          tone={stats.totalProfit >= 0 ? "positive" : "negative"}
        />
        <StatCard
          label="ROI"
          value={formatPercent(stats.roi, true)}
          tone={stats.roi >= 0 ? "positive" : "negative"}
        />
        <StatCard
          label="Win rate"
          value={formatPercent(stats.winRate)}
          sub={`${stats.won} vinte su ${stats.won + stats.lost} decise`}
        />
        <StatCard
          label="Drawdown max"
          value={formatSignedEuro(-drawdown.amount)}
          sub={`${formatPercent(drawdown.pct)} dal picco`}
          tone="negative"
        />
      </div>

      <div className="card mb-6 p-5">
        <h2 className="text-sm font-semibold tracking-tight text-zinc-100">
          Andamento bankroll
        </h2>
        <p className="text-xs text-zinc-500">
          Bankroll iniziale + profitto cumulato sulle giocate chiuse
        </p>
        <div className="mt-4">
          <EquityChart points={equity} />
        </div>
      </div>

      <div className="space-y-4">
        <GroupTable title="Per campionato" rows={byCompetition} />
        <GroupTable title="Per mercato" rows={byMarket} />
        <GroupTable title="Per fascia di quota" rows={byOdds} />
      </div>
    </div>
  );
}
