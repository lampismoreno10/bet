import { BudgetManager } from "@/components/budget-manager";
import { StatCard } from "@/components/stat-card";
import {
  computeBankroll,
  getBankrollTransactions,
  getBets,
  getBudgets,
} from "@/lib/data";
import { formatDate, formatPercent, formatSignedEuro } from "@/lib/format";
import { computeStats } from "@/lib/stats";
import type { BetRecord, Budget } from "@/types";

export const dynamic = "force-dynamic";

function formatPeriod(periodType: "monthly" | "annual", period: string): string {
  if (periodType === "monthly") {
    const [y, m] = period.split("-");
    const d = new Date(Number(y), Number(m) - 1, 1);
    return d.toLocaleDateString("it-IT", { month: "long", year: "numeric" });
  }
  return `Anno ${period}`;
}

function stakedInPeriod(records: BetRecord[], period: string): number {
  return records
    .filter((r) => r.bet.createdAt.startsWith(period))
    .reduce((s, r) => s + r.bet.stake, 0);
}

export default async function BudgetPage() {
  const [budgets, transactions, records] = await Promise.all([
    getBudgets(),
    getBankrollTransactions(),
    getBets(),
  ]);

  const bets = records.map((r) => r.bet);
  const stats = computeStats(bets, 0);
  const bankroll = computeBankroll(transactions);
  const capital = bankroll + stats.totalProfit;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-100">
          Budget
        </h1>
        <p className="text-sm text-zinc-500">
          Budget mensile e annuale, bankroll e movimenti
        </p>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard
          label="Bankroll"
          value={formatSignedEuro(bankroll)}
          sub="depositi − prelievi"
        />
        <StatCard
          label="Profitto totale"
          value={formatSignedEuro(stats.totalProfit)}
          tone={stats.totalProfit >= 0 ? "positive" : "negative"}
        />
        <StatCard
          label="Capitale attuale"
          value={formatSignedEuro(capital)}
          sub="bankroll + profitto"
          tone="accent"
        />
      </div>

      <h2 className="mb-3 text-sm font-semibold tracking-tight text-zinc-100">
        Gestisci budget e fondi
      </h2>
      <BudgetManager />

      <h2 className="mb-3 mt-8 text-sm font-semibold tracking-tight text-zinc-100">
        Limiti di budget
      </h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {budgets.map((b) => (
          <BudgetCard
            key={b.id}
            budget={b}
            staked={stakedInPeriod(records, b.period)}
          />
        ))}
      </div>

      <h2 className="mb-3 mt-8 text-sm font-semibold tracking-tight text-zinc-100">
        Movimenti bankroll
      </h2>
      <div className="card overflow-hidden">
        {transactions.length === 0 ? (
          <p className="p-6 text-sm text-zinc-500">Nessun movimento.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-white/[0.05] text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Data</th>
                  <th className="px-4 py-3 font-medium">Tipo</th>
                  <th className="px-4 py-3 font-medium">Nota</th>
                  <th className="px-4 py-3 text-right font-medium">Importo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.05]">
                {transactions.map((t) => (
                  <tr key={t.id}>
                    <td className="whitespace-nowrap px-4 py-3 text-zinc-500">
                      {formatDate(t.createdAt)}
                    </td>
                    <td className="px-4 py-3 capitalize text-zinc-300">
                      {t.type}
                    </td>
                    <td className="px-4 py-3 text-zinc-500">{t.note ?? "—"}</td>
                    <td
                      className={`px-4 py-3 text-right font-medium tabular-nums ${
                        t.amount > 0
                          ? "text-emerald-400"
                          : t.amount < 0
                            ? "text-rose-400"
                            : "text-zinc-500"
                      }`}
                    >
                      {formatSignedEuro(t.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function BudgetCard({
  budget,
  staked,
}: {
  budget: Budget;
  staked: number;
}) {
  const pct = budget.amount > 0 ? (staked / budget.amount) * 100 : 0;
  const over = pct > 100;
  const color = over
    ? "bg-rose-400"
    : pct >= 80
      ? "bg-amber-400"
      : "bg-emerald-400";
  const remaining = budget.amount - staked;

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-zinc-100">
          {formatPeriod(budget.periodType, budget.period)}
        </p>
        <span className="text-[11px] uppercase tracking-wider text-zinc-500">
          {budget.periodType === "monthly" ? "Mensile" : "Annuale"}
        </span>
      </div>

      <p className="mt-3 text-2xl font-semibold tracking-tight tabular-nums text-zinc-100">
        {formatSignedEuro(budget.amount)}
      </p>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <div className="rounded-xl bg-white/[0.03] p-3">
          <p className="label">Utilizzato</p>
          <p className="mt-1 text-sm font-semibold tabular-nums text-zinc-100">
            {formatSignedEuro(staked)}
          </p>
        </div>
        <div className="rounded-xl bg-white/[0.03] p-3">
          <p className="label">Residuo</p>
          <p
            className={`mt-1 text-sm font-semibold tabular-nums ${
              over ? "text-rose-400" : "text-emerald-400"
            }`}
          >
            {formatSignedEuro(remaining)}
          </p>
        </div>
      </div>

      <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-white/5">
        <div
          className={`h-full ${color}`}
          style={{ width: `${Math.min(100, pct)}%` }}
        />
      </div>
      <p className="mt-2 text-xs text-zinc-500">
        {over
          ? `Sforamento del ${formatPercent(pct - 100)}`
          : `${formatPercent(pct)} del budget utilizzato`}
      </p>
    </div>
  );
}
