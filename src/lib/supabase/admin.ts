// ============================================================
// Client Supabase con SERVICE ROLE — SOLO SERVER-SIDE.
//
// ⚠️ La service role key bypassa la RLS: NON deve mai finire nel bundle
// del browser. Questo modulo è importabile solo da codice server (route
// handler del cron, server action). La variabile NON ha prefisso
// NEXT_PUBLIC_ proprio per impedirne l'esposizione.
//
// È usato esclusivamente dal job giornaliero, che gira senza sessione
// utente e quindi non può usare il client anon.
// ============================================================

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/** True se la service role è configurata (diagnostica). */
export function isServiceRoleConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

/**
 * Crea un client con service role, oppure null se la chiave non è
 * configurata: il chiamante deve degradare, non indovinare.
 */
export function createServiceRoleClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
