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
 * Controllo accesso admin per le funzioni di importazione e analisi.
 *
 * In PRODUZIONE una whitelist vuota NON abilita nessun admin: altrimenti
 * qualsiasi utente autenticato potrebbe consumare la quota API-Football e le
 * chiamate DeepSeek. In sviluppo si mantiene il comportamento comodo
 * (nessuna whitelist => tutti admin), ma solo fuori dalla produzione.
 */
export function isAdminEmail(email: string | null | undefined): boolean {
  const list = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  if (list.length === 0) return process.env.NODE_ENV !== "production";
  if (!email) return false;
  return list.includes(email.toLowerCase());
}

/** True se la whitelist admin è configurata (per diagnostica/UI). */
export function isAdminWhitelistConfigured(): boolean {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean).length > 0;
}

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
