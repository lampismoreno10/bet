"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { markAsPlayed } from "@/app/(dashboard)/actions";

export function MarkAsPlayedButton({
  matchId,
  analysisId,
  isDemo,
}: {
  matchId: string;
  analysisId: string;
  isDemo: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function handleClick() {
    if (isDemo) {
      setMessage(
        "DEMO: azione dimostrativa. Con Supabase collegato la giocata verrà salvata e inserita nel report."
      );
      return;
    }

    setMessage(null);
    setPending(true);
    try {
      const res = await markAsPlayed(matchId, analysisId);
      if (res?.error) {
        setMessage(res.error);
      } else {
        setMessage("Giocata salvata e inserita nel report.");
        router.refresh();
      }
    } catch {
      setMessage("Errore imprevisto. Riprova.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col items-stretch gap-1.5 sm:items-end">
      <button onClick={handleClick} disabled={pending} className="btn-success">
        {pending ? "Salvataggio…" : "Segna come giocata"}
      </button>
      {message && (
        <span className="max-w-xs text-xs text-zinc-500 sm:text-right">
          {message}
        </span>
      )}
    </div>
  );
}
