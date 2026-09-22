import { formatDateTime } from "@/lib/format";
import type { Match, MatchState } from "@/types";

const STATE_STYLES: Record<MatchState, { className: string; label: string }> = {
  scheduled: { className: "bg-zinc-500/10 text-zinc-400 ring-zinc-500/20", label: "In programma" },
  live: { className: "bg-emerald-400/10 text-emerald-300 ring-emerald-400/20", label: "In corso" },
  finished: { className: "bg-zinc-500/10 text-zinc-500 ring-zinc-500/20", label: "Terminata" },
};

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

/** Elenco compatto delle partite importate che non hanno ancora un'analisi. */
export function ImportedFixturesList({ matches }: { matches: Match[] }) {
  if (matches.length === 0) return null;

  return (
    <div className="card divide-y divide-white/[0.05]">
      {matches.map((m) => (
        <div
          key={m.id}
          className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3"
        >
          <span className="shrink-0 text-xs tabular-nums text-zinc-400">
            {formatDateTime(m.kickoffAt)}
          </span>
          <span className="max-w-[220px] shrink-0 truncate text-xs text-zinc-500">
            {m.competition}
          </span>
          <span className="min-w-0 flex-1 truncate text-sm text-zinc-100">
            {m.homeTeam} <span className="text-zinc-500">vs</span> {m.awayTeam}
          </span>
          <MatchStateBadge state={m.state} />
        </div>
      ))}
    </div>
  );
}
