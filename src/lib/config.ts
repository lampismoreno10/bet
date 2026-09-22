// ============================================================
// Configurazione dell'app e gestione della modalità DEMO.
// ============================================================

export function isSupabaseConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

/**
 * Modalità DEMO attiva quando:
 * - è forzata via NEXT_PUBLIC_DEMO_MODE=true, oppure
 * - Supabase non è ancora configurato.
 * In modalità DEMO l'app mostra dati fittizi chiaramente etichettati
 * e non richiede autenticazione.
 */
export function isDemoMode(): boolean {
  if (process.env.NEXT_PUBLIC_DEMO_MODE === "true") return true;
  return !isSupabaseConfigured();
}

/**
 * Controllo accesso admin per le funzioni di importazione.
 * Se `ADMIN_EMAILS` non è impostata, qualsiasi utente autenticato è admin
 * (comodo in sviluppo). In produzione conviene valorizzarla con la lista
 * delle email separate da virgola.
 */
export function isAdminEmail(email: string | null | undefined): boolean {
  const list = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  if (list.length === 0) return true;
  if (!email) return false;
  return list.includes(email.toLowerCase());
}

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
