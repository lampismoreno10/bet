import Link from "next/link";

import { ImportedFixturesList } from "@/components/imported-fixtures-list";
import { MatchCard } from "@/components/match-card";
import { StatCard } from "@/components/stat-card";
import { SyncFixturesPanel } from "@/components/sync-fixtures-panel";
import { isAdminEmail, isDemoMode } from "@/lib/config";
import {
  computeBankroll,
  getBankrollTransactions,
  getBets,
  getCandidateMatches,
  getFixturesWithoutAnalysis,
  getLastSyncRun,
  getTodayApiUsage,
} from "@/lib/data";
import { currentMonthPeriod, isToday, monthPeriodOf } from "@/lib/dates";
import { formatEuro, formatPercent } from "@/lib/format";
import { computeStats } from "@/lib/stats";
import { createClient } from "@/lib/supabase/server";
import type { Match, SyncRun } from "@/types";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const demo = isDemoMode();

  const [matches, records, transactions] = await Promise.all([
    getCandidateMatches(),
    getBets(),
    getBankrollTransactions(),
  ]);

  let isAdmin = false;
  let importedFixtures: Match[] = [];
  let lastRun: SyncRun | null = null;
  let todayUsage = { requests: 0, runs: 0 };

  if (!demo) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    isAdmin = isAdminEmail(user?.email);

    const [imported, run, usage] = await Promise.all([
      getFixturesWithoutAnalysis(),
      getLastSyncRun(),
      getTodayApiUsage(),
    ]);
    importedFixtures = imported;
    lastRun = run;
    todayUsage = usage;
  }

  const bets = records.map((r) => r.bet);
  const stats = computeStats(bets, 0);
  const bankroll = computeBankroll(transactions);
  const capital = bankroll + stats.totalProfit;

  const period = currentMonthPeriod();
  const monthProfit = bets
    .filter((b) => b.status !== "open")
    .reduce((sum, b) => {
      const d = b.settledAt ?? b.createdAt;
      return monthPeriodOf(d) === period ? sum + b.profit : sum;
    }, 0);

  const todayCandidates = matches.filter((m) => isToday(m.match.kickoffAt)).length;

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-100">
            Oggi
          </h1>
          <p className="text-sm text-zinc-500">
            Panoramica e partite candidate
          </p>
        </div>
        <Link href="/matches/new" className="btn-primary">
          + Nuova partita
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard
          label="Capitale attuale"
          value={formatEuro(capital)}
          sub="bankroll + profitto"
          tone="accent"
        />
        <StatCard
          label="Profitto mese"
          value={formatEuro(monthProfit)}
          tone={monthProfit >= 0 ? "positive" : "negative"}
        />
        <StatCard
          label="ROI"
          value={formatPercent(stats.roi, true)}
          tone={stats.roi >= 0 ? "positive" : "negative"}
        />
        <StatCard
          label="Giocate aperte"
          value={String(stats.open)}
          sub="in attesa di esito"
        />
        <StatCard
          label="Candidate oggi"
          value={String(todayCandidates)}
          sub={`${matches.length} totali`}
        />
      </div>

      {!demo && (
        <div className="mt-6">
          <SyncFixturesPanel
            isAdmin={isAdmin}
            lastRun={lastRun}
            todayRequests={todayUsage.requests}
          />
        </div>
      )}

      <div className="mb-4 mt-8 flex items-end justify-between">
        <h2 className="text-lg font-semibold tracking-tight text-zinc-100">
          Partite candidate
        </h2>
        <span className="text-sm text-zinc-500">{matches.length} partite</span>
      </div>

      {matches.length === 0 ? (
        <div className="card p-12 text-center">
          <p className="text-sm font-medium text-zinc-200">
            Nessuna partita candidata
          </p>
          <p className="mx-auto mt-1 max-w-md text-sm text-zinc-500">
            Aggiungi una partita con la relativa analisi, oppure importa le
            partite di oggi con &quot;Aggiorna partite&quot;.
          </p>
          <Link href="/matches/new" className="btn-primary mt-4">
            + Nuova partita
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          {matches.map((item) => (
            <MatchCard key={item.match.id} item={item} isDemo={demo} />
          ))}
        </div>
      )}

      {importedFixtures.length > 0 && (
        <>
          <div className="mb-4 mt-8 flex items-end justify-between">
            <div>
              <h2 className="text-lg font-semibold tracking-tight text-zinc-100">
                Partite importate
              </h2>
              <p className="text-sm text-zinc-500">
                In attesa di analisi
              </p>
            </div>
            <span className="text-sm text-zinc-500">
              {importedFixtures.length} partite
            </span>
          </div>

          <ImportedFixturesList matches={importedFixtures} />
        </>
      )}
    </div>
  );
}
