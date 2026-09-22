"use server";

// ============================================================
// Importazione partite da API-Football.
//
// Gira SOLO sul server: la chiave `SPORTS_API_KEY` non viene mai
// esposta al browser. Consuma 1 sola richiesta API per esecuzione
// (endpoint /fixtures?date=... restituisce tutte le partite del giorno;
// il filtro sui campionati avviene in locale).
// ============================================================

import { revalidatePath } from "next/cache";

import { isAdminEmail } from "@/lib/config";
import { todayIsoDate } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";
import {
  fetchFixturesByDate,
  isSportsApiConfigured,
  SportsApiError,
} from "@/lib/sports/api-football";
import type { MatchState, SyncOutcome, SyncRunStatus } from "@/types";

const UPSERT_CHUNK_SIZE = 200;

/** Stati API-Football raggruppati secondo il nostro modello. */
const FINISHED_STATUSES = new Set(["FT", "AET", "PEN", "AWD", "WO"]);
const LIVE_STATUSES = new Set([
  "1H",
  "HT",
  "2H",
  "ET",
  "BT",
  "P",
  "SUSP",
  "INT",
  "LIVE",
]);

function mapFixtureStatus(short: string): MatchState {
  if (FINISHED_STATUSES.has(short)) return "finished";
  if (LIVE_STATUSES.has(short)) return "live";
  return "scheduled";
}

/** Costruisce un esito con tutti i campi valorizzati. */
function outcome(
  o: Partial<SyncOutcome> & { status: SyncRunStatus; message: string }
): SyncOutcome {
  return {
    requestsUsed: 0,
    requestsLimit: null,
    requestsRemaining: null,
    fixturesFound: 0,
    fixturesImported: 0,
    fixturesInserted: 0,
    ...o,
    ok: o.status === "ok",
  };
}

/** Traduce gli errori Postgres tipici in un messaggio che spiega cosa fare. */
function migrationHint(code?: string): string | null {
  if (code === "42P01") {
    return "Manca la tabella api_sync_runs. Esegui supabase/migrations/002_fixture_sync.sql nella SQL Editor di Supabase.";
  }
  if (code === "42P10") {
    return "Manca il vincolo di unicità su matches(user_id, external_id). Esegui supabase/migrations/002_fixture_sync.sql nella SQL Editor di Supabase.";
  }
  return null;
}

export async function syncFixtures(): Promise<SyncOutcome> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return outcome({ status: "error", message: "Non autenticato." });
  }

  if (!isAdminEmail(user.email)) {
    return outcome({
      status: "error",
      message: "Solo un amministratore può aggiornare le partite.",
    });
  }

  if (!isSportsApiConfigured()) {
    return outcome({
      status: "error",
      message:
        "SPORTS_API_KEY non è configurata sul server. Aggiungila alle variabili d'ambiente (Vercel) e rideploya.",
    });
  }

  const date = todayIsoDate();
  const userId = user.id;

  // Il log non deve mai bloccare l'import: se la tabella non esiste
  // (migrazione non ancora eseguita) semplicemente non registriamo.
  async function recordRun(
    status: SyncRunStatus,
    fields: {
      requestsUsed: number;
      fixturesFound: number;
      fixturesImported: number;
      fixturesInserted: number;
      requestsLimit?: number | null;
      requestsRemaining?: number | null;
      errorMessage?: string | null;
    }
  ): Promise<void> {
    try {
      await supabase.from("api_sync_runs").insert({
        user_id: userId,
        source: "api-football",
        sync_date: date,
        requests_used: fields.requestsUsed,
        requests_limit: fields.requestsLimit ?? null,
        requests_remaining: fields.requestsRemaining ?? null,
        fixtures_found: fields.fixturesFound,
        fixtures_imported: fields.fixturesImported,
        fixtures_inserted: fields.fixturesInserted,
        status,
        error_message: fields.errorMessage ?? null,
      });
    } catch {
      // ignora: il log è accessorio
    }
  }

  try {
    const result = await fetchFixturesByDate(date);
    const quota = result.quota;
    const pagesNote =
      result.pagesTotal > 1
        ? ` ⚠️ L'API ha suddiviso i risultati in ${result.pagesTotal} pagine: sono state importate solo le prime.`
        : "";

    if (result.fixtures.length === 0) {
      await recordRun("ok", {
        requestsUsed: 1,
        fixturesFound: 0,
        fixturesImported: 0,
        fixturesInserted: 0,
        requestsLimit: quota.requestsLimit,
        requestsRemaining: quota.requestsRemaining,
      });

      return outcome({
        status: "ok",
        message:
          (result.totalReturned === 0
            ? `Nessuna partita in programma il ${date}.`
            : `Nessuna partita dei campionati seguiti il ${date} (l'API ne ha restituite ${result.totalReturned} in totale).`) +
          pagesNote,
        requestsUsed: 1,
        requestsLimit: quota.requestsLimit,
        requestsRemaining: quota.requestsRemaining,
      });
    }

    const rows = result.fixtures.map((f) => ({
      user_id: userId,
      external_id: String(f.fixture.id),
      competition: f.league.name,
      home_team: f.teams.home.name,
      away_team: f.teams.away.name,
      kickoff_at: f.fixture.date,
      status: mapFixtureStatus(f.fixture.status.short),
    }));

    // Quante sono davvero nuove? Serve per non dire "importate" anche
    // quando in realtà sono solo aggiornate.
    const { data: existingRows } = await supabase
      .from("matches")
      .select("external_id")
      .eq("user_id", userId)
      .not("external_id", "is", null);

    const existingIds = new Set(
      (existingRows ?? []).map((r) => String(r.external_id))
    );
    const inserted = rows.filter((r) => !existingIds.has(r.external_id)).length;

    let imported = 0;
    for (let i = 0; i < rows.length; i += UPSERT_CHUNK_SIZE) {
      const chunk = rows.slice(i, i + UPSERT_CHUNK_SIZE);
      const { error } = await supabase
        .from("matches")
        .upsert(chunk, { onConflict: "user_id,external_id" });

      if (error) {
        const hint = migrationHint(error.code);
        const message = hint ?? `Errore nel salvataggio: ${error.message}`;

        await recordRun("error", {
          requestsUsed: 1,
          fixturesFound: result.fixtures.length,
          fixturesImported: imported,
          fixturesInserted: 0,
          requestsLimit: quota.requestsLimit,
          requestsRemaining: quota.requestsRemaining,
          errorMessage: message,
        });

        return outcome({
          status: "error",
          message,
          requestsUsed: 1,
          requestsLimit: quota.requestsLimit,
          requestsRemaining: quota.requestsRemaining,
          fixturesFound: result.fixtures.length,
          fixturesImported: imported,
        });
      }

      imported += chunk.length;
    }

    await recordRun("ok", {
      requestsUsed: 1,
      fixturesFound: result.fixtures.length,
      fixturesImported: imported,
      fixturesInserted: inserted,
      requestsLimit: quota.requestsLimit,
      requestsRemaining: quota.requestsRemaining,
    });

    revalidatePath("/", "layout");

    const updated = imported - inserted;
    return outcome({
      status: "ok",
      message: `${inserted} nuove partite${
        updated > 0 ? `, ${updated} già presenti e aggiornate` : ""
      } (${result.fixtures.length} dai campionati seguiti).${pagesNote}`,
      requestsUsed: 1,
      requestsLimit: quota.requestsLimit,
      requestsRemaining: quota.requestsRemaining,
      fixturesFound: result.fixtures.length,
      fixturesImported: imported,
      fixturesInserted: inserted,
    });
  } catch (err) {
    const isSports = err instanceof SportsApiError;
    const kind = isSports ? err.kind : "unknown";
    const status: SyncRunStatus =
      kind === "quota_exceeded" ? "quota_exceeded" : "error";
    const message = isSports
      ? err.message
      : err instanceof Error
        ? err.message
        : "Errore imprevisto durante l'importazione.";

    await recordRun(status, {
      requestsUsed: 1,
      fixturesFound: 0,
      fixturesImported: 0,
      fixturesInserted: 0,
      errorMessage: message,
    });

    return outcome({
      status,
      message,
      requestsUsed: 1,
    });
  }
}
