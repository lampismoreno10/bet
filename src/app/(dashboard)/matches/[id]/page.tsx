import Link from "next/link";
import { notFound } from "next/navigation";

import { EditAnalysisForm } from "@/components/edit-analysis-form";
import { MarkAsPlayedButton } from "@/components/mark-as-played-button";
import { AnalysisStatusBadge } from "@/components/status-badge";
import { isDemoMode } from "@/lib/config";
import { getMatchDetail } from "@/lib/data";
import {
  formatDateTime,
  formatEv,
  formatOdds,
  formatPercent,
  formatProbability,
} from "@/lib/format";
import type { Analysis } from "@/types";

export const dynamic = "force-dynamic";

export default async function MatchDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const demo = isDemoMode();
  const detail = await getMatchDetail(id);

  if (!detail) notFound();

  const { match, analysis } = detail;
  const canPlay =
    analysis.state === "da_valutare" || analysis.state === "giocabile";

  const impliedProb =
    analysis.bet365Odds != null && analysis.bet365Odds > 0
      ? 1 / analysis.bet365Odds
      : 0;
  const edge =
    analysis.bet365Odds != null && analysis.fairOdds > 0
      ? (analysis.bet365Odds / analysis.fairOdds - 1) * 100
      : 0;

  return (
    <div className="space-y-4">
      <Link
        href="/dashboard"
        className="text-sm font-medium text-indigo-300 hover:text-indigo-200"
      >
        ← Torna alla dashboard
      </Link>

      {/* Header */}
      <div className="card p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm text-zinc-500">{match.competition}</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-zinc-100">
              {match.homeTeam}{" "}
              <span className="font-normal text-zinc-500">vs</span>{" "}
              {match.awayTeam}
            </h1>
            <p className="mt-1 text-sm text-zinc-500">
              Calcio d&apos;inizio: {formatDateTime(match.kickoffAt)}
            </p>
          </div>
          <AnalysisStatusBadge state={analysis.state} />
        </div>
      </div>

      {/* Highlight quote/prob/EV */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Highlight
          label="Quota bookmaker"
          value={formatOdds(analysis.bet365Odds)}
        />
        <Highlight label="Quota equa" value={formatOdds(analysis.fairOdds)} />
        <Highlight
          label="Probabilità"
          value={formatProbability(analysis.estimatedProbability)}
        />
        <Highlight
          label="EV"
          value={formatEv(analysis.ev)}
          tone={
            analysis.ev == null
              ? "text-zinc-500"
              : analysis.ev >= 0
                ? "text-emerald-400"
                : "text-rose-400"
          }
        />
      </div>

      {/* Sezioni */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Analisi">
          <dl className="space-y-3 text-sm">
            <Row label="Mercato consigliato">
              {analysis.market} · {analysis.selection}
            </Row>
            <Row label="Quota di analisi">
              {formatOdds(analysis.analysisOdds)}
            </Row>
            <div>
              <dt className="label mb-1.5">Affidabilità</dt>
              <dd className="flex items-center gap-3">
                <div className="h-1.5 w-full max-w-[200px] overflow-hidden rounded-full bg-white/5">
                  <div
                    className={`h-full ${
                      analysis.confidence >= 70
                        ? "bg-emerald-400"
                        : analysis.confidence >= 50
                          ? "bg-amber-400"
                          : "bg-rose-400"
                    }`}
                    style={{
                      width: `${Math.min(100, analysis.confidence)}%`,
                    }}
                  />
                </div>
                <span className="font-semibold tabular-nums text-zinc-200">
                  {analysis.confidence}%
                </span>
              </dd>
            </div>
          </dl>
        </Section>

        <Section title="Statistiche">
          <dl className="space-y-3 text-sm">
            <Row label="Probabilità stimata">
              {formatProbability(analysis.estimatedProbability)}
            </Row>
            <Row label="Probabilità implicita bookmaker">
              {formatProbability(impliedProb)}
            </Row>
            <Row label="Quota equa">{formatOdds(analysis.fairOdds)}</Row>
            <Row
              label="Edge vs quota equa"
              tone={edge >= 0 ? "text-emerald-400" : "text-rose-400"}
            >
              {formatPercent(edge, true)}
            </Row>
          </dl>
        </Section>

        <Section title="Quote">
          <dl className="space-y-3 text-sm">
            <Row label="Quota di analisi">
              {formatOdds(analysis.analysisOdds)}
            </Row>
            <Row label="Quota bookmaker (Bet365)">
              {formatOdds(analysis.bet365Odds)}
            </Row>
            <Row label="Quota equa">{formatOdds(analysis.fairOdds)}</Row>
            <Row label="Differenza bookmaker − equa">
              {analysis.bet365Odds != null
                ? formatOdds(analysis.bet365Odds - analysis.fairOdds)
                : "—"}
            </Row>
          </dl>
        </Section>

        <Section title="Rischi">
          <p className="whitespace-pre-line text-sm leading-relaxed text-zinc-400">
            {analysis.risks || "Nessun rischio segnalato."}
          </p>
        </Section>

        <Section title="Motivazioni">
          <p className="whitespace-pre-line text-sm leading-relaxed text-zinc-400">
            {motivationText(analysis)}
          </p>
        </Section>

        <Section title="Decisione finale">
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <AnalysisStatusBadge state={analysis.state} />
            </div>
            <p className="text-sm leading-relaxed text-zinc-300">
              {decisionText(analysis)}
            </p>
            {canPlay && (
              <div className="flex justify-start">
                <MarkAsPlayedButton
                  matchId={match.id}
                  analysisId={analysis.id}
                  isDemo={demo}
                />
              </div>
            )}
          </div>
        </Section>
      </div>

      <EditAnalysisForm match={match} analysis={analysis} isDemo={demo} />
    </div>
  );
}

function Highlight({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div className="card p-4">
      <p className="label">{label}</p>
      <p
        className={`mt-2 text-2xl font-semibold tracking-tight tabular-nums ${
          tone ?? "text-zinc-100"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="card p-5">
      <h2 className="text-sm font-semibold tracking-tight text-zinc-100">
        {title}
      </h2>
      <div className="mt-3">{children}</div>
    </div>
  );
}

function Row({
  label,
  children,
  tone,
}: {
  label: string;
  children: React.ReactNode;
  tone?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-zinc-500">{label}</dt>
      <dd className={`font-medium tabular-nums text-zinc-200 ${tone ?? ""}`}>
        {children}
      </dd>
    </div>
  );
}

function decisionText(a: Analysis): string {
  switch (a.state) {
    case "scartata":
      return "Partita scartata: nessun valore rispetto alla quota equa.";
    case "giocata":
      return "Giocata registrata e in attesa di esito.";
    case "chiusa":
      return "Giocata chiusa e archiviata.";
    case "giocabile":
      return "Valore positivo rilevato: partita giocabile.";
    default:
      if (a.ev == null) {
        return "EV non calcolabile: nessuna quota bookmaker reale disponibile.";
      }
      return a.ev > 0
        ? "EV positivo ma sotto soglia: da valutare con attenzione."
        : "EV negativo: sconsigliata.";
  }
}

function motivationText(a: Analysis): string {
  const parts: string[] = [];
  if (a.ev == null) {
    parts.push("EV non calcolabile: manca una quota bookmaker reale.");
  } else if (a.ev > 0) {
    parts.push(`EV positivo del ${(a.ev * 100).toFixed(1)}% rispetto alla quota equa.`);
  } else {
    parts.push("EV negativo: la quota giocabile è inferiore alla quota equa.");
  }
  if (a.confidence >= 70) {
    parts.push("Affidabilità del modello alta.");
  } else if (a.confidence >= 50) {
    parts.push("Affidabilità del modello media.");
  } else {
    parts.push("Affidabilità del modello bassa.");
  }
  return parts.join(" ");
}
