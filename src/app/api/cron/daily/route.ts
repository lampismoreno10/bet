// ============================================================
// Job giornaliero automatico (Vercel Cron).
//
// Ordine di esecuzione:
//   1. aggiorna i risultati delle partite precedenti (+ settlement automatico)
//   2. sincronizza le partite (oggi + domani)
//   3. trova le candidate in whitelist
//   4. raccoglie il contesto statistico (OpenFootball, altrimenti fallback)
//   5. raccoglie le quote reali
//   6. interroga DeepSeek
//   7. salva le analisi
//
// Protetto da CRON_SECRET: senza header `Authorization: Bearer <secret>`
// la richiesta viene rifiutata. Le server action leggono lo stesso header
// per autorizzare il job, che gira senza sessione utente (service role).
//
// ⚠️ SPORTS_API_KEY, DEEPSEEK_API_KEY, CRON_SECRET e
// SUPABASE_SERVICE_ROLE_KEY restano SOLO sul server: nessuna di queste
// variabili ha il prefisso NEXT_PUBLIC_ e nessuna viene inviata al client.
// ============================================================

import { NextResponse } from "next/server";

import {
  runFullPipeline,
  updateResults,
} from "@/app/(dashboard)/analysis-actions";
import { isServiceRoleConfigured } from "@/lib/supabase/admin";

/** Il job fa più chiamate sequenziali: serve tempo. */
export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: "CRON_SECRET non configurato sul server." },
      { status: 503 }
    );
  }
  if ((request.headers.get("authorization") ?? "") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  if (!isServiceRoleConfigured()) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "SUPABASE_SERVICE_ROLE_KEY non configurata: il job cron non può girare senza sessione utente.",
      },
      { status: 503 }
    );
  }

  const startedAt = new Date().toISOString();

  // 1. Risultati + settlement delle giocate maturabili.
  const results = await updateResults();

  // 2-7. Sync, candidate, contesto, quote, DeepSeek, salvataggio.
  const pipeline = await runFullPipeline();

  return NextResponse.json({
    ok: results.ok && pipeline.ok,
    startedAt,
    finishedAt: new Date().toISOString(),
    results,
    pipeline,
  });
}
