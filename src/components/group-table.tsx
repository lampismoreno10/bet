import { formatPercent, formatSignedEuro } from "@/lib/format";
import type { GroupStat } from "@/lib/stats";

export function GroupTable({
  title,
  rows,
}: {
  title: string;
  rows: GroupStat[];
}) {
  return (
    <div className="card p-5">
      <h2 className="text-sm font-semibold tracking-tight text-zinc-100">
        {title}
      </h2>

      {rows.length === 0 ? (
        <p className="mt-2 text-sm text-zinc-500">Nessun dato.</p>
      ) : (
        <table className="mt-3 w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-zinc-500">
            <tr>
              <th className="py-2 font-medium">Raggruppamento</th>
              <th className="py-2 text-right font-medium">Giocate</th>
              <th className="py-2 text-right font-medium">Giocato</th>
              <th className="py-2 text-right font-medium">P/L</th>
              <th className="py-2 text-right font-medium">ROI</th>
              <th className="py-2 text-right font-medium">Win rate</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.05]">
            {rows.map((r) => (
              <tr key={r.key}>
                <td className="py-2 font-medium text-zinc-200">{r.key}</td>
                <td className="py-2 text-right tabular-nums text-zinc-400">
                  {r.bets}
                </td>
                <td className="py-2 text-right tabular-nums text-zinc-400">
                  {formatSignedEuro(r.staked)}
                </td>
                <td
                  className={`py-2 text-right font-medium tabular-nums ${
                    r.profit > 0
                      ? "text-emerald-400"
                      : r.profit < 0
                        ? "text-rose-400"
                        : "text-zinc-500"
                  }`}
                >
                  {formatSignedEuro(r.profit)}
                </td>
                <td
                  className={`py-2 text-right tabular-nums ${
                    r.roi >= 0 ? "text-emerald-400" : "text-rose-400"
                  }`}
                >
                  {formatPercent(r.roi, true)}
                </td>
                <td className="py-2 text-right tabular-nums text-zinc-400">
                  {formatPercent(r.winRate)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
