"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { settleBet } from "@/app/(dashboard)/actions";

export function SettleBetControls({
  betId,
  isDemo,
}: {
  betId: string;
  isDemo: boolean;
}) {
  const router = useRouter();
  const [stake, setStake] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function doSettle(status: "won" | "lost" | "void") {
    if (isDemo) {
      setMessage("DEMO: azione dimostrativa (con Supabase salverà l'esito).");
      return;
    }

    const value = parseFloat(stake.replace(",", "."));
    if (Number.isNaN(value) || value < 0) {
      setMessage("Inserisci un importo valido.");
      return;
    }

    setMessage(null);
    setPending(true);
    try {
      const res = await settleBet(betId, status, value);
      if (res?.error) {
        setMessage(res.error);
      } else {
        setMessage(null);
        router.refresh();
      }
    } catch {
      setMessage("Errore imprevisto. Riprova.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        value={stake}
        onChange={(e) => setStake(e.target.value)}
        placeholder="Importo €"
        inputMode="decimal"
        className="input w-24 px-2 py-1"
      />
      <button
        onClick={() => doSettle("won")}
        disabled={pending}
        className="rounded-lg bg-emerald-500/90 px-2.5 py-1 text-xs font-medium text-emerald-950 transition hover:bg-emerald-400 disabled:opacity-60"
      >
        Vinta
      </button>
      <button
        onClick={() => doSettle("lost")}
        disabled={pending}
        className="rounded-lg bg-rose-500/90 px-2.5 py-1 text-xs font-medium text-white transition hover:bg-rose-400 disabled:opacity-60"
      >
        Persa
      </button>
      <button
        onClick={() => doSettle("void")}
        disabled={pending}
        className="rounded-lg border border-white/10 px-2.5 py-1 text-xs font-medium text-zinc-400 transition hover:bg-white/5 hover:text-zinc-200 disabled:opacity-60"
      >
        Annulla
      </button>
      {message && <span className="text-xs text-zinc-500">{message}</span>}
    </div>
  );
}
