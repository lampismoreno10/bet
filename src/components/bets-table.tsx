"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

import { SettleBetControls } from "@/components/settle-bet-controls";
import { BetStatusBadge } from "@/components/status-badge";
import {
  formatDate,
  formatEv,
  formatOdds,
  formatPercent,
  formatSignedEuro,
} from "@/lib/format";
import type { BetRecord, BetStatus } from "@/types";

type Filter = "all" | BetStatus;

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "Tutte" },
  { key: "open", label: "Pending" },
  { key: "won", label: "Vinte" },
  { key: "lost", label: "Perse" },
  { key: "void", label: "Annullate" },
];

export function BetsTable({
  records,
  isDemo,
}: {
  records: BetRecord[];
  isDemo: boolean;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  const counts = useMemo(() => {
    const c: Record<Filter, number> = {
      all: records.length,
      open: 0,
      won: 0,
      lost: 0,
      void: 0,
    };
    for (const r of records) {
      c[r.bet.status] = (c[r.bet.status] ?? 0) + 1;
    }
    return c;
  }, [records]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return records.filter(({ bet, match }) => {
      if (filter !== "all" && bet.status !== filter) return false;
      if (!q) return true;
      const hay =
        `${match.homeTeam} ${match.awayTeam} ${match.competition} ${bet.market} ${bet.selection}`.toLowerCase();
      return hay.includes(q);
    });
  }, [records, query, filter]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                filter === f.key
                  ? "bg-indigo-500 text-white"
                  : "bg-white/5 text-zinc-400 hover:bg-white/10 hover:text-zinc-200"
              }`}
            >
              {f.label}
              <span className="ml-1.5 opacity-60">{counts[f.key]}</span>
            </button>
          ))}
        </div>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Cerca squadra, campionato, mercato…"
          className="input w-full sm:w-72"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="card p-12 text-center">
          <p className="text-sm font-medium text-zinc-200">Nessuna giocata</p>
          <p className="mt-1 text-sm text-zinc-500">
            {records.length === 0
              ? "Quando segni una partita come giocata comparirà qui."
              : "Nessun risultato per i filtri selezionati."}
          </p>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-white/[0.05] text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Data</th>
                  <th className="px-4 py-3 font-medium">Partita</th>
                  <th className="px-4 py-3 font-medium">Mercato</th>
                  <th className="px-4 py-3 text-right font-medium">Quota</th>
                  <th className="px-4 py-3 text-right font-medium">Stake</th>
                  <th className="px-4 py-3 text-right font-medium">EV</th>
                  <th className="px-4 py-3 text-right font-medium">CLV</th>
                  <th className="px-4 py-3 font-medium">Esito</th>
                  <th className="px-4 py-3 text-right font-medium">P/L</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.05]">
                {filtered.map(({ bet, match }) => {
                  const clv =
                    bet.closingOdds != null && bet.odds > 0
                      ? (bet.odds / bet.closingOdds - 1) * 100
                      : null;
                  return (
                    <tr key={bet.id} className="align-top transition hover:bg-white/[0.02]">
                      <td className="whitespace-nowrap px-4 py-3 text-zinc-500">
                        {formatDate(bet.settledAt ?? bet.createdAt)}
                      </td>
                      <td className="px-4 py-3">
                        <Link
                          href={`/matches/${match.id}`}
                          className="font-medium text-zinc-100 hover:text-indigo-300"
                        >
                          {match.homeTeam} – {match.awayTeam}
                        </Link>
                        <div className="text-xs text-zinc-500">
                          {match.competition}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-zinc-400">
                        {bet.market} · {bet.selection}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-zinc-200">
                        {formatOdds(bet.odds)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-zinc-200">
                        {formatSignedEuro(bet.stake)}
                      </td>
                      <td
                        className={`px-4 py-3 text-right tabular-nums ${
                          bet.ev >= 0 ? "text-emerald-400" : "text-rose-400"
                        }`}
                      >
                        {formatEv(bet.ev)}
                      </td>
                      <td
                        className={`px-4 py-3 text-right tabular-nums ${
                          clv == null
                            ? "text-zinc-600"
                            : clv >= 0
                              ? "text-emerald-400"
                              : "text-rose-400"
                        }`}
                      >
                        {clv == null ? "—" : formatPercent(clv, true)}
                      </td>
                      <td className="px-4 py-3">
                        <BetStatusBadge status={bet.status} />
                        {bet.status === "open" && (
                          <div className="mt-2">
                            <SettleBetControls betId={bet.id} isDemo={isDemo} />
                          </div>
                        )}
                      </td>
                      <td
                        className={`whitespace-nowrap px-4 py-3 text-right font-medium tabular-nums ${
                          bet.profit > 0
                            ? "text-emerald-400"
                            : bet.profit < 0
                              ? "text-rose-400"
                              : "text-zinc-500"
                        }`}
                      >
                        {formatSignedEuro(bet.profit)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
