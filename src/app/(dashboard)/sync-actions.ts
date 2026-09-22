"use server";

// ============================================================
// Importazione partite da API-Football (oggi + domani + dopodomani).
//
// Gira SOLO sul server: la chiave `SPORTS_API_KEY` non viene mai
// esposta al browser. Consuma 1 richiesta API per ogni data (3 in
// totale), poi filtra i campionati seguiti in locale: niente chiamate
// partita per partita.
// ============================================================

import { revalidatePath } from "next/cache";

import { isAdminEmail } from "@/lib/config";
import { isoDateOffset, todayIsoDate } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";
import {
  fetchFixturesByDates,
  isSportsApiConfigured,
  SportsApiError,
} from "@/lib/sports/api-football";
import type { MatchState, SyncOutcome, SyncRunStatus } from "@/types";

const UPSERT_CHUNK_SIZE = 200;
const SYNC_DAYS = 3; // oggi + domani + dopodomani

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

  const userId = user.id;
  const dates: string[] = [];
  for (let i = 0; i < SYNC_DAYS; i++) dates.push(i === 0 ? todayIsoDate() : isoDateOffset(i));

  // Il log non deve mai bloccare l'import.
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
        sync_date: dates[0],
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
    const result = await fetchFixturesByDates(dates);
    const quota = result.quota;
    const pagesNote =
      result.pagesTotal > 1
        ? ` ⚠️ L'API ha suddiviso i risultati in ${result.pagesTotal} pagine: sono state importate solo le prime.`
        : "";

    if (result.fixtures.length === 0) {
      await recordRun("ok", {
        requestsUsed: result.requestsUsed,
        fixturesFound: 0,
        fixturesImported: 0,
        fixturesInserted: 0,
        requestsLimit: quota.requestsLimit,
        requestsRemaining: quota.requestsRemaining,
      });

      const leagueNames = result.leaguesFound
        .slice(0, 15)
        .map((l) => `${l.name} (ID ${l.id})`)
        .join(", ");
      const more =
        result.leaguesFound.length > 15
          ? `, +${result.leaguesFound.length - 15} altri`
          : "";
      const diagnostic =
        result.totalReturned === 0
          ? ""
          : leagueNames
            ? ` Campionati presenti nella risposta: ${leagueNames}${more}.`
            : " Attenzione: le partite non riportano il campo 'league'.";

      return outcome({
        status: "ok",
        message:
          (result.totalReturned === 0
            ? `Nessuna partita in programma tra ${dates[0]} e ${dates[dates.length - 1]}.`
            : `Nessuna partita dei campionati seguiti tra ${dates[0]} e ${dates[dates.length - 1]} (${result.totalReturned} totali).${diagnostic}`) +
          pagesNote,
        requestsUsed: result.requestsUsed,
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
      league_id: f.league.id,
      season: f.league.season,
      home_team_id: f.teams.home.id,
      away_team_id: f.teams.away.id,
    }));

    // Quante sono davvero nuove?
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
          requestsUsed: result.requestsUsed,
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
          requestsUsed: result.requestsUsed,
          requestsLimit: quota.requestsLimit,
          requestsRemaining: quota.requestsRemaining,
          fixturesFound: result.fixtures.length,
          fixturesImported: imported,
        });
      }

      imported += chunk.length;
    }

    await recordRun("ok", {
      requestsUsed: result.requestsUsed,
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
      } (${result.fixtures.length} dai campionati seguiti, ${dates[0]} → ${dates[dates.length - 1]}).${pagesNote}`,
      requestsUsed: result.requestsUsed,
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
      requestsUsed: dates.length,
      fixturesFound: 0,
      fixturesImported: 0,
      fixturesInserted: 0,
      errorMessage: message,
    });

    return outcome({
      status,
      message,
      requestsUsed: dates.length,
    });
  }
}
