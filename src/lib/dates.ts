// ============================================================
// Helper per periodi e date (timezone Europa/Roma).
// ============================================================

export const TIME_ZONE = "Europe/Rome";

const monthFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
});

const dayFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Data odierna in formato "YYYY-MM-DD" (timezone Europa/Roma). */
export function todayIsoDate(now: Date = new Date()): string {
  return dayFmt.format(now);
}

/** Periodo mensile "YYYY-MM" di una data ISO. */
export function monthPeriodOf(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return monthFmt.format(d);
}

/** Periodo mensile corrente "YYYY-MM". */
export function currentMonthPeriod(now: Date = new Date()): string {
  return monthFmt.format(now);
}

/** Anno corrente "YYYY". */
export function currentYearPeriod(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
  }).format(now);
}

/** True se la data ISO cade oggi (timezone Europa/Roma). */
export function isToday(iso: string, now: Date = new Date()): boolean {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  return dayFmt.format(d) === dayFmt.format(now);
}

/**
 * Converte una data ISO nel formato richiesto da <input type="datetime-local">
 * ("YYYY-MM-DDTHH:mm"), usando il fuso del browser.
 * Da chiamare lato client (es. in un useEffect) per evitare disallineamenti
 * tra server e browser.
 */
export function toDateTimeLocal(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}
