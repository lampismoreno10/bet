"use server";

// ============================================================
// Importazione partite da API-Football (piano Free).
//
// Gira SOLO sul server: la chiave `SPORTS_API_KEY` non viene mai
// esposta al browser. Consuma 1 richiesta API per ogni data; il filtro
// sui campionati seguiti avviene in locale: niente chiamate
// partita per partita.
//
// Resilienza: se una data viene rifiutata dall'API (es. fuori dal range
// consentito dal piano Free), la sincronizzazione NON si interrompe:
// prosegue con le date valide e riporta per ogni data l'esito.
// ============================================================

import { revalidatePath } from "next/cache";

import { resolveAdminContext } from "@/lib/auth/admin-context";
import { isoDateOffset } from "@/lib/dates";
import {
  fetchFixturesByDates,
  isSportsApiConfigured,
  SportsApiError,
} from "@/lib/sports/api-football";
import type { MatchState, SyncOutcome, SyncRunStatus } from "@/types";

const UPSERT_CHUNK_SIZE = 200;

// Piano Free: oggi + domani (2 date). Ogni data = 1 richiesta API.
// Per tornare a 3/7 giorni (piano Pro) basta aumentare questo valore.
const SYNC_DAYS = 2;

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
    totalReturned: 0,
    fixturesFound: 0,
    fixturesImported: 0,
    fixturesInserted: 0,
    datesChecked: 0,
    dateStatuses: [],
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
  // Contesto admin: sessione utente oppure job cron (service role).
  const auth = await resolveAdminContext();
  if (!auth.ok) {
    return outcome({ status: "error", message: auth.message });
  }
  const { userId, supabase } = auth.ctx;

  if (!isSportsApiConfigured()) {
    return outcome({
      status: "error",
      message:
        "SPORTS_API_KEY non è configurata sul server. Aggiungila alle variabili d'ambiente (Vercel) e rideploya.",
    });
  }

  const dates: string[] = [];
  for (let i = 0; i < SYNC_DAYS; i++) dates.push(isoDateOffset(i));

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

  let result;
  try {
    result = await fetchFixturesByDates(dates);
  } catch (err) {
    // fetchFixturesByDates non lancia più per errori di singola data;
    // questo catch copre solo imprevisti.
    const message =
      err instanceof SportsApiError
        ? err.message
        : err instanceof Error
          ? err.message
          : "Errore imprevisto durante l'importazione.";

    await recordRun("error", {
      requestsUsed: dates.length,
      fixturesFound: 0,
      fixturesImported: 0,
      fixturesInserted: 0,
      errorMessage: message,
    });

    return outcome({
      status: "error",
      message,
      requestsUsed: dates.length,
      datesChecked: dates.length,
      dateStatuses: dates.map((d) => ({ date: d, ok: false, reason: message })),
    });
  }

  const quota = result.quota;
  const requestsUsed = result.requestsUsed;
  const dateStatuses = result.dates.map((d) => ({
    date: d.date,
    ok: d.ok,
    reason: d.ok ? undefined : (d.errorMessage ?? undefined),
  }));
  const successDates = result.dates.filter((d) => d.ok);
  const failedDates = result.dates.filter((d) => !d.ok);
  const totalReturned = successDates.reduce((s, d) => s + d.totalReturned, 0);
  const pagesNote =
    result.pagesTotal > 1
      ? ` ⚠️ L'API ha suddiviso i risultati in ${result.pagesTotal} pagine: sono state importate solo le prime.`
      : "";

  // Tutte le date fallite -> errore (o quota esaurita).
  if (successDates.length === 0) {
    const quotaExceeded = failedDates.some((d) => d.errorKind === "quota_exceeded");
    const status: SyncRunStatus = quotaExceeded ? "quota_exceeded" : "error";
    const reason = failedDates
      .map((d) => `${d.date}: ${d.errorMessage ?? "errore"}`)
      .join(" · ");
    const message = quotaExceeded
      ? "Quota API esaurita: nessuna data sincronizzabile."
      : `Nessuna data sincronizzabile (${reason}).`;

    await recordRun(status, {
      requestsUsed,
      fixturesFound: 0,
      fixturesImported: 0,
      fixturesInserted: 0,
      requestsLimit: quota.requestsLimit,
      requestsRemaining: quota.requestsRemaining,
      errorMessage: message,
    });

    return outcome({
      status,
      message,
      requestsUsed,
      requestsLimit: quota.requestsLimit,
      requestsRemaining: quota.requestsRemaining,
      totalReturned,
      datesChecked: dates.length,
      dateStatuses,
    });
  }

  const warnings = failedDates.length > 0;

  // Nessuna partita dei campionati seguiti (ma qualche data è andata a buon fine).
  if (result.fixtures.length === 0) {
    await recordRun("ok", {
      requestsUsed,
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
      totalReturned === 0
        ? ""
        : leagueNames
          ? ` Campionati presenti nella risposta: ${leagueNames}${more}.`
          : " Attenzione: le partite non riportano il campo 'league'.";

    return outcome({
      status: "ok",
      message:
        (totalReturned === 0
          ? "Nessuna partita in programma nelle date richieste."
          : `Nessuna partita dei campionati seguiti (${totalReturned} totali).${diagnostic}`) +
        (warnings ? " Alcune date sono state saltate." : "") +
        pagesNote,
      requestsUsed,
      requestsLimit: quota.requestsLimit,
      requestsRemaining: quota.requestsRemaining,
      totalReturned,
      datesChecked: dates.length,
      dateStatuses,
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
        requestsUsed,
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
        requestsUsed,
        requestsLimit: quota.requestsLimit,
        requestsRemaining: quota.requestsRemaining,
        totalReturned,
        fixturesFound: result.fixtures.length,
        fixturesImported: imported,
        datesChecked: dates.length,
        dateStatuses,
      });
    }

    imported += chunk.length;
  }

  await recordRun("ok", {
    requestsUsed,
    fixturesFound: result.fixtures.length,
    fixturesImported: imported,
    fixturesInserted: inserted,
    requestsLimit: quota.requestsLimit,
    requestsRemaining: quota.requestsRemaining,
    errorMessage: warnings
      ? failedDates.map((d) => `${d.date}: ${d.errorMessage ?? "non disponibile"}`).join(" | ")
      : null,
  });

  revalidatePath("/", "layout");

  const updated = imported - inserted;
  const warningNote = warnings
    ? ` (${failedDates.length} data/e saltata/e: ${failedDates.map((d) => d.date).join(", ")})`
    : "";

  return outcome({
    status: "ok",
    message: `${inserted} nuove partite${
      updated > 0 ? `, ${updated} aggiornate` : ""
    } (${result.fixtures.length} dai campionati seguiti).${warningNote}${pagesNote}`,
    requestsUsed,
    requestsLimit: quota.requestsLimit,
    requestsRemaining: quota.requestsRemaining,
    totalReturned,
    fixturesFound: result.fixtures.length,
    fixturesImported: imported,
    fixturesInserted: inserted,
    datesChecked: dates.length,
    dateStatuses,
  });
}
