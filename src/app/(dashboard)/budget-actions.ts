"use server";

// ============================================================
// Operazioni sul budget / bankroll (solo utente autenticato).
// ============================================================

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";

const round2 = (n: number) => Math.round(n * 100) / 100;

function isValidAmount(v: number): boolean {
  return Number.isFinite(v) && v > 0;
}

function isValidPeriod(periodType: "monthly" | "annual", period: string): boolean {
  if (periodType === "monthly") return /^\d{4}-\d{2}$/.test(period);
  return /^\d{4}$/.test(period);
}

/** Crea o aggiorna il budget di un periodo (upsert: niente duplicati). */
export async function setBudget(input: {
  periodType: "monthly" | "annual";
  period: string;
  amount: number;
}): Promise<{ error?: string; ok?: boolean }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Non autenticato" };

  if (!isValidPeriod(input.periodType, input.period)) {
    return { error: "Periodo non valido." };
  }
  if (!isValidAmount(input.amount)) {
    return { error: "Importo non valido (deve essere maggiore di zero)." };
  }

  const { error } = await supabase.from("budgets").upsert(
    {
      user_id: user.id,
      period_type: input.periodType,
      period: input.period,
      amount: round2(input.amount),
    },
    { onConflict: "user_id,period_type,period" }
  );

  if (error) return { error: error.message };
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Registra un deposito (transazione positiva). */
export async function addFunds(input: {
  amount: number;
  note?: string;
}): Promise<{ error?: string; ok?: boolean }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Non autenticato" };

  if (!isValidAmount(input.amount)) {
    return { error: "Importo non valido (deve essere maggiore di zero)." };
  }

  const { error } = await supabase.from("bankroll_transactions").insert({
    user_id: user.id,
    type: "deposit",
    amount: round2(input.amount),
    note: input.note?.trim() || null,
  });

  if (error) return { error: error.message };
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Registra un prelievo (transazione negativa). */
export async function withdrawFunds(input: {
  amount: number;
  note?: string;
}): Promise<{ error?: string; ok?: boolean }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Non autenticato" };

  if (!isValidAmount(input.amount)) {
    return { error: "Importo non valido (deve essere maggiore di zero)." };
  }

  const { error } = await supabase.from("bankroll_transactions").insert({
    user_id: user.id,
    type: "withdrawal",
    amount: -round2(input.amount),
    note: input.note?.trim() || null,
  });

  if (error) return { error: error.message };
  revalidatePath("/", "layout");
  return { ok: true };
}
