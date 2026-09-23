import Link from "next/link";

import { MarkAsPlayedButton } from "@/components/mark-as-played-button";
import { AnalysisStatusBadge } from "@/components/status-badge";
import {
  formatDateTime,
  formatEv,
  formatOdds,
  formatProbability,
} from "@/lib/format";
import type { CandidateMatch } from "@/types";

export function MatchCard({
  item,
  isDemo,
}: {
  item: CandidateMatch;
  isDemo: boolean;
}) {
  const { match, analysis } = item;
  const canPlay =
    analysis.state === "da_valutare" || analysis.state === "giocabile";
  const evTone =
    analysis.ev == null
      ? "text-zinc-500"
      : analysis.ev >= 0
        ? "text-emerald-400"
        : "text-rose-400";

  return (
    <div className="card p-5 transition hover:border-white/[0.12]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-500">
            <span>{match.competition}</span>
            <span className="text-zinc-700">•</span>
            <span>{formatDateTime(match.kickoffAt)}</span>
          </div>
          <Link
            href={`/matches/${match.id}`}
            className="mt-1.5 block text-lg font-semibold tracking-tight text-zinc-100 hover:text-indigo-300"
          >
            {match.homeTeam}{" "}
            <span className="font-normal text-zinc-500">vs</span> {match.awayTeam}
          </Link>
        </div>
        <AnalysisStatusBadge state={analysis.state} />
      </div>

      <div className="mt-5 grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-3 lg:grid-cols-6">
        <div className="col-span-2 sm:col-span-3 lg:col-span-2">
          <p className="label">Mercato consigliato</p>
          <p className="mt-1 text-sm font-semibold text-zinc-100">
            {analysis.market}
          </p>
          <p className="text-sm text-zinc-400">{analysis.selection}</p>
        </div>
        <Metric label="Quota analisi" value={formatOdds(analysis.analysisOdds)} />
        <Metric label="Quota Bet365" value={formatOdds(analysis.bet365Odds)} />
        <Metric
          label="Prob. stimata"
          value={formatProbability(analysis.estimatedProbability)}
        />
        <Metric label="Quota equa" value={formatOdds(analysis.fairOdds)} />
        <Metric label="EV" value={formatEv(analysis.ev)} tone={evTone} />
      </div>

      <div className="mt-5 flex items-center gap-3">
        <span className="label">Affidabilità</span>
        <div className="h-1.5 w-full max-w-[160px] overflow-hidden rounded-full bg-white/5">
          <div
            className={`h-full ${
              analysis.confidence >= 70
                ? "bg-emerald-400"
                : analysis.confidence >= 50
                  ? "bg-amber-400"
                  : "bg-rose-400"
            }`}
            style={{ width: `${Math.min(100, Math.max(0, analysis.confidence))}%` }}
          />
        </div>
        <span className="text-xs font-semibold text-zinc-300">
          {analysis.confidence}%
        </span>
      </div>

      {analysis.risks && (
        <p className="mt-4 line-clamp-2 text-sm text-zinc-500">
          {analysis.risks}
        </p>
      )}

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.05] pt-4">
        <Link
          href={`/matches/${match.id}`}
          className="text-sm font-medium text-indigo-300 hover:text-indigo-200"
        >
          Dettaglio analisi →
        </Link>
        {canPlay && (
          <MarkAsPlayedButton
            matchId={match.id}
            analysisId={analysis.id}
            isDemo={isDemo}
          />
        )}
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div>
      <p className="label">{label}</p>
      <p
        className={`mt-1 text-sm font-semibold tabular-nums ${
          tone ?? "text-zinc-100"
        }`}
      >
        {value}
      </p>
    </div>
  );
}
