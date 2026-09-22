import { BetsTable } from "@/components/bets-table";
import { StatCard } from "@/components/stat-card";
import { isDemoMode } from "@/lib/config";
import { getBets } from "@/lib/data";
import {
  formatEv,
  formatOdds,
  formatPercent,
  formatSignedEuro,
} from "@/lib/format";
import { computeStats } from "@/lib/stats";

export const dynamic = "force-dynamic";

export default async function ArchivePage() {
  const demo = isDemoMode();
  const records = await getBets();
  const stats = computeStats(
    records.map((r) => r.bet),
    0
  );

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-100">
          Archivio Giocate
        </h1>
        <p className="text-sm text-zinc-500">
          Tutte le giocate con profitto, ROI e statistiche di sintesi
        </p>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard
          label="Profitto / Perdita"
          value={formatSignedEuro(stats.totalProfit)}
          sub={`${stats.won} vinte · ${stats.lost} perse · ${stats.voids} annullate`}
          tone={stats.totalProfit >= 0 ? "positive" : "negative"}
        />
        <StatCard
          label="ROI"
          value={formatPercent(stats.roi, true)}
          sub={`su ${formatSignedEuro(stats.totalStaked)} giocati`}
          tone={stats.roi >= 0 ? "positive" : "negative"}
        />
        <StatCard
          label="Win rate"
          value={formatPercent(stats.winRate)}
          sub="sulle giocate decise"
        />
        <StatCard label="Quota media" value={formatOdds(stats.avgOdds)} />
        <StatCard
          label="EV medio"
          value={formatEv(stats.avgEv)}
          tone={stats.avgEv >= 0 ? "positive" : "negative"}
        />
        <StatCard
          label="CLV medio"
          value={stats.avgClv != null ? formatPercent(stats.avgClv, true) : "—"}
          tone={
            stats.avgClv != null
              ? stats.avgClv >= 0
                ? "positive"
                : "negative"
              : "neutral"
          }
        />
        <StatCard
          label="Drawdown max"
          value={formatSignedEuro(-stats.maxDrawdown)}
          sub={`${formatPercent(stats.maxDrawdownPct)} dal picco`}
          tone="negative"
        />
        <StatCard
          label="Giocate aperte"
          value={String(stats.open)}
          sub="in attesa di esito"
          tone="accent"
        />
      </div>

      <BetsTable records={records} isDemo={demo} />
    </div>
  );
}
