// ============================================================
// Contesto amministrativo condiviso dalle operazioni server-side.
//
// Due percorsi di autenticazione, entrambi verificati QUI:
//   1. JOB CRON — richiesta con header `Authorization: Bearer CRON_SECRET`.
//      Gira senza sessione utente, quindi usa la service role e opera
//      sull'utente indicato da CRON_USER_ID. Richiede entrambe le
//      variabili: se mancano, l'operazione viene rifiutata (nessun
//      fallback silenzioso).
//   2. UTENTE — sessione Supabase + whitelist ADMIN_EMAILS.
//
// In produzione una whitelist vuota NON abilita nessun admin: vedi
// `lib/config.ts`.
// ============================================================

import { headers } from "next/headers";

import { isAdminEmail } from "@/lib/config";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface AdminContext {
  userId: string;
  supabase: SupabaseClient;
  /** True quando il contesto arriva dal job cron (service role). */
  viaCron: boolean;
}

export type AdminContextResult =
  | { ok: true; ctx: AdminContext }
  | { ok: false; message: string };

export async function resolveAdminContext(): Promise<AdminContextResult> {
  const secret = process.env.CRON_SECRET;
  const authorization = (await headers()).get("authorization") ?? "";

  // 1) Job cron: header con il segreto condiviso.
  if (secret && authorization === `Bearer ${secret}`) {
    const supabase = createServiceRoleClient();
    if (!supabase) {
      return {
        ok: false,
        message:
          "Job cron: SUPABASE_SERVICE_ROLE_KEY non configurata sul server.",
      };
    }
    const userId = process.env.CRON_USER_ID;
    if (!userId) {
      return { ok: false, message: "Job cron: CRON_USER_ID non configurato." };
    }
    return { ok: true, ctx: { userId, supabase, viaCron: true } };
  }

  // 2) Utente autenticato con sessione.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { ok: false, message: "Non autenticato." };
  if (!isAdminEmail(user.email)) {
    return {
      ok: false,
      message: "Solo un amministratore può eseguire questa operazione.",
    };
  }
  return { ok: true, ctx: { userId: user.id, supabase, viaCron: false } };
}
