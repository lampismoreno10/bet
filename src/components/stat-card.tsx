type Tone = "positive" | "negative" | "neutral" | "accent";

const TONES: Record<Tone, string> = {
  positive: "text-emerald-400",
  negative: "text-rose-400",
  neutral: "text-zinc-100",
  accent: "text-indigo-300",
};

export function StatCard({
  label,
  value,
  sub,
  tone = "neutral",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: Tone;
}) {
  return (
    <div className="card p-4">
      <p className="label">{label}</p>
      <p
        className={`mt-2 text-2xl font-semibold tracking-tight tabular-nums ${TONES[tone]}`}
      >
        {value}
      </p>
      {sub && <p className="mt-1 text-xs text-zinc-500">{sub}</p>}
    </div>
  );
}
