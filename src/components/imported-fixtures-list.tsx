"use client";

import { useState } from "react";

import { formatDateTime } from "@/lib/format";
import { getLeagueKind, type LeagueKind } from "@/lib/sports/leagues";
import type { Match, MatchState } from "@/types";

const STATE_STYLES: Record<MatchState, { className: string; label: string }> = {
  scheduled: {
    className: "bg-zinc-500/10 text-zinc-400 ring-zinc-500/20",
    label: "In programma",
  },
  live: {
    className: "bg-emerald-400/10 text-emerald-300 ring-emerald-400/20",
    label: "In corso",
  },
  finished: {
    className: "bg-zinc-500/10 text-zinc-500 ring-zinc-500/20",
    label: "Terminata",
  },
};

const KIND_BADGE: Record<LeagueKind, { className: string; label: string }> = {
  club: {
    className: "bg-indigo-500/10 text-indigo-300 ring-indigo-500/20",
    label: "CLUB",
  },
  national: {
    className: "bg-violet-500/10 text-violet-300 ring-violet-500/20",
    label: "NAZIONALI",
  },
};

type Filter = "all" | LeagueKind;

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "Tutte" },
  { key: "club", label: "Club" },
  { key: "national", label: "Nazionali" },
];

function MatchStateBadge({ state }: { state: MatchState }) {
  const s = STATE_STYLES[state];
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${s.className}`}
    >
      {s.label}
    </span>
  );
}

/** Elenco delle partite importate in attesa di analisi, con tipo (club/nazionali) e filtro. */
export function ImportedFixturesList({ matches }: { matches: Match[] }) {
  const [filter, setFilter] = useState<Filter>("all");

  const filtered = matches.filter((m) => {
    if (filter === "all") return true;
    return getLeagueKind(m.leagueId) === filter;
  });

  if (matches.length === 0) return null;

  return (
    <div className="space-y-3">
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
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="card p-6 text-center text-sm text-zinc-500">
          Nessuna partita per questo filtro.
        </div>
      ) : (
        <div className="card divide-y divide-white/[0.05]">
          {filtered.map((m) => {
            const kind = getLeagueKind(m.leagueId);
            return (
              <div
                key={m.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3"
              >
                <span className="shrink-0 text-xs tabular-nums text-zinc-400">
                  {formatDateTime(m.kickoffAt)}
                </span>
                {kind && (
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ring-1 ring-inset ${KIND_BADGE[kind].className}`}
                  >
                    {KIND_BADGE[kind].label}
                  </span>
                )}
                <span className="max-w-[200px] shrink-0 truncate text-xs text-zinc-500">
                  {m.competition}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm text-zinc-100">
                  {m.homeTeam}{" "}
                  <span className="text-zinc-500">vs</span> {m.awayTeam}
                </span>
                <MatchStateBadge state={m.state} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
