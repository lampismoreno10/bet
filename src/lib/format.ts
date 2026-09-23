// ============================================================
// Formattatori (formato italiano).
//
// Tutti i formati che coinvolgono date forzano `timeZone: TIME_ZONE`:
// in produzione il server (Vercel) gira in UTC, quindi senza questo gli
// orari delle partite risulterebbero spostati di 1-2 ore.
// ============================================================

import { TIME_ZONE } from "@/lib/dates";

const euroFormatter = new Intl.NumberFormat("it-IT", {
  style: "currency",
  currency: "EUR",
});

const numberFormatter = new Intl.NumberFormat("it-IT", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatEuro(value: number): string {
  return euroFormatter.format(value);
}

/** Euro con segno esplicito per i positivi (es. "+42,50 €"). */
export function formatSignedEuro(value: number): string {
  return value > 0 ? `+${euroFormatter.format(value)}` : euroFormatter.format(value);
}

export function formatNumber(value: number): string {
  return numberFormatter.format(value);
}

/** Quota decimale: sempre 2 decimali. "—" quando la quota non esiste. */
export function formatOdds(value: number | null | undefined): string {
  if (value == null) return "—";
  return value.toFixed(2);
}

/** Percentuale con segno opzionale. */
export function formatPercent(value: number, signed = false): string {
  const sign = signed && value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

/** EV in forma decimale -> percentuale con segno. "—" quando non è calcolabile. */
export function formatEv(value: number | null | undefined): string {
  if (value == null) return "—";
  const sign = value >= 0 ? "+" : "";
  return `${sign}${(value * 100).toFixed(2)}%`;
}

/** Probabilità 0..1 -> percentuale. */
export function formatProbability(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("it-IT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: TIME_ZONE,
  });
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("it-IT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: TIME_ZONE,
  });
}

/** Solo ora/minuto (per i calci d'inizio). */
export function formatTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("it-IT", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: TIME_ZONE,
  });
}
