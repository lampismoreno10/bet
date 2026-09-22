import { formatDate, formatEuro } from "@/lib/format";
import type { EquityPoint } from "@/lib/stats";

export function EquityChart({
  points,
  height = 240,
}: {
  points: EquityPoint[];
  height?: number;
}) {
  if (points.length < 2) {
    return (
      <p className="text-sm text-zinc-500">Dati insufficienti per il grafico.</p>
    );
  }

  const w = 800;
  const padL = 8;
  const padR = 8;
  const padT = 12;
  const padB = 8;
  const innerW = w - padL - padR;
  const innerH = height - padT - padB;

  const values = points.map((p) => p.bankroll);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const lo = min - range * 0.12;
  const hi = max + range * 0.12;

  const x = (i: number) => padL + (i / (points.length - 1)) * innerW;
  const y = (v: number) => padT + (1 - (v - lo) / (hi - lo)) * innerH;

  const line = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.bankroll).toFixed(1)}`)
    .join(" ");
  const area = `${line} L${x(points.length - 1).toFixed(1)},${padT + innerH} L${x(0).toFixed(1)},${padT + innerH} Z`;

  const first = points[0];
  const last = points[points.length - 1];
  const up = last.bankroll >= first.bankroll;
  const color = up ? "#34d399" : "#fb7185";

  const grid = [0, 1, 2, 3].map((t) => {
    const v = lo + (t / 3) * (hi - lo);
    return y(v);
  });

  return (
    <div>
      <svg
        viewBox={`0 0 ${w} ${height}`}
        className="w-full"
        preserveAspectRatio="none"
        style={{ height }}
      >
        <defs>
          <linearGradient id="eq-fill-up" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#34d399" stopOpacity="0.22" />
            <stop offset="100%" stopColor="#34d399" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="eq-fill-down" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#fb7185" stopOpacity="0.22" />
            <stop offset="100%" stopColor="#fb7185" stopOpacity="0" />
          </linearGradient>
        </defs>

        {grid.map((gy, i) => (
          <line
            key={i}
            x1={padL}
            x2={w - padR}
            y1={gy}
            y2={gy}
            stroke="rgba(255,255,255,0.05)"
            strokeWidth="1"
          />
        ))}

        <path d={area} fill={up ? "url(#eq-fill-up)" : "url(#eq-fill-down)"} />
        <path
          d={line}
          fill="none"
          stroke={color}
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </svg>

      <div className="mt-2 flex justify-between text-xs text-zinc-500">
        <span>{first.date ? formatDate(first.date) : "Inizio"}</span>
        <span className={up ? "text-emerald-400" : "text-rose-400"}>
          {formatEuro(last.bankroll)}
        </span>
      </div>
    </div>
  );
}
