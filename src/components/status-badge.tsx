import type { AnalysisState, BetStatus } from "@/types";

function Badge({
  className,
  dotClassName,
  children,
}: {
  className: string;
  dotClassName: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${className}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${dotClassName}`} />
      {children}
    </span>
  );
}

const ANALYSIS: Record<
  AnalysisState,
  { className: string; dot: string; label: string }
> = {
  da_valutare: {
    className: "bg-amber-400/10 text-amber-300 ring-amber-400/20",
    dot: "bg-amber-400",
    label: "Da valutare",
  },
  giocabile: {
    className: "bg-emerald-400/10 text-emerald-300 ring-emerald-400/20",
    dot: "bg-emerald-400",
    label: "Giocabile",
  },
  scartata: {
    className: "bg-rose-400/10 text-rose-300 ring-rose-400/20",
    dot: "bg-rose-400",
    label: "Scartata",
  },
  giocata: {
    className: "bg-sky-400/10 text-sky-300 ring-sky-400/20",
    dot: "bg-sky-400",
    label: "Giocata",
  },
  chiusa: {
    className: "bg-zinc-500/10 text-zinc-400 ring-zinc-500/20",
    dot: "bg-zinc-500",
    label: "Chiusa",
  },
};

const BET: Record<BetStatus, { className: string; dot: string; label: string }> =
  {
    open: {
      className: "bg-amber-400/10 text-amber-300 ring-amber-400/20",
      dot: "bg-amber-400",
      label: "Pending",
    },
    won: {
      className: "bg-emerald-400/10 text-emerald-300 ring-emerald-400/20",
      dot: "bg-emerald-400",
      label: "Vinta",
    },
    lost: {
      className: "bg-rose-400/10 text-rose-300 ring-rose-400/20",
      dot: "bg-rose-400",
      label: "Persa",
    },
    void: {
      className: "bg-zinc-500/10 text-zinc-400 ring-zinc-500/20",
      dot: "bg-zinc-500",
      label: "Annullata",
    },
  };

export function AnalysisStatusBadge({ state }: { state: AnalysisState }) {
  const c = ANALYSIS[state];
  return (
    <Badge className={c.className} dotClassName={c.dot}>
      {c.label}
    </Badge>
  );
}

export function BetStatusBadge({ status }: { status: BetStatus }) {
  const c = BET[status];
  return (
    <Badge className={c.className} dotClassName={c.dot}>
      {c.label}
    </Badge>
  );
}
