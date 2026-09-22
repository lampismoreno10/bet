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

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
