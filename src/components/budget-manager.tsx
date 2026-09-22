"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { addFunds, setBudget, withdrawFunds } from "@/app/(dashboard)/budget-actions";

type Msg = { tone: "ok" | "error"; text: string } | null;

function toNumber(v: string): number {
  return parseFloat(v.replace(",", "."));
}

function MsgBox({ msg }: { msg: Msg }) {
  if (!msg) return null;
  return (
    <p
      className={`rounded-lg px-3 py-2 text-xs ${
        msg.tone === "ok"
          ? "bg-emerald-500/10 text-emerald-300"
          : "bg-rose-500/10 text-rose-300"
      }`}
    >
      {msg.text}
    </p>
  );
}

export function BudgetManager() {
  const router = useRouter();

  // Imposta budget
  const [periodType, setPeriodType] = useState<"monthly" | "annual">("monthly");
  const [monthPeriod, setMonthPeriod] = useState("");
  const [yearPeriod, setYearPeriod] = useState("");
  const [budgetAmount, setBudgetAmount] = useState("");
  const [budgetBusy, setBudgetBusy] = useState(false);
  const [budgetMsg, setBudgetMsg] = useState<Msg>(null);

  // Deposito
  const [depositAmount, setDepositAmount] = useState("");
  const [depositNote, setDepositNote] = useState("");
  const [depositBusy, setDepositBusy] = useState(false);
  const [depositMsg, setDepositMsg] = useState<Msg>(null);

  // Prelievo
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [withdrawNote, setWithdrawNote] = useState("");
  const [withdrawBusy, setWithdrawBusy] = useState(false);
  const [withdrawMsg, setWithdrawMsg] = useState<Msg>(null);

  async function handleSetBudget(e: React.FormEvent) {
    e.preventDefault();
    setBudgetMsg(null);
    const period = periodType === "monthly" ? monthPeriod : yearPeriod;
    const amount = toNumber(budgetAmount);
    if (!period) {
      setBudgetMsg({ tone: "error", text: "Seleziona il periodo." });
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      setBudgetMsg({ tone: "error", text: "Importo non valido (deve essere > 0)." });
      return;
    }

    setBudgetBusy(true);
    try {
      const res = await setBudget({ periodType, period, amount });
      if (res?.error) {
        setBudgetMsg({ tone: "error", text: res.error });
      } else {
        setBudgetMsg({ tone: "ok", text: "Budget salvato." });
        router.refresh();
      }
    } catch {
      setBudgetMsg({ tone: "error", text: "Errore imprevisto." });
    } finally {
      setBudgetBusy(false);
    }
  }

  async function handleDeposit(e: React.FormEvent) {
    e.preventDefault();
    setDepositMsg(null);
    const amount = toNumber(depositAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setDepositMsg({ tone: "error", text: "Importo non valido (deve essere > 0)." });
      return;
    }
    setDepositBusy(true);
    try {
      const res = await addFunds({ amount, note: depositNote });
      if (res?.error) {
        setDepositMsg({ tone: "error", text: res.error });
      } else {
        setDepositMsg({ tone: "ok", text: "Deposito registrato." });
        setDepositAmount("");
        setDepositNote("");
        router.refresh();
      }
    } catch {
      setDepositMsg({ tone: "error", text: "Errore imprevisto." });
    } finally {
      setDepositBusy(false);
    }
  }

  async function handleWithdraw(e: React.FormEvent) {
    e.preventDefault();
    setWithdrawMsg(null);
    const amount = toNumber(withdrawAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setWithdrawMsg({ tone: "error", text: "Importo non valido (deve essere > 0)." });
      return;
    }
    setWithdrawBusy(true);
    try {
      const res = await withdrawFunds({ amount, note: withdrawNote });
      if (res?.error) {
        setWithdrawMsg({ tone: "error", text: res.error });
      } else {
        setWithdrawMsg({ tone: "ok", text: "Prelievo registrato." });
        setWithdrawAmount("");
        setWithdrawNote("");
        router.refresh();
      }
    } catch {
      setWithdrawMsg({ tone: "error", text: "Errore imprevisto." });
    } finally {
      setWithdrawBusy(false);
    }
  }

  const inputCls = "input w-full";

  return (
    <div className="space-y-4">
      {/* Imposta budget */}
      <form onSubmit={handleSetBudget} className="card p-5">
        <h3 className="text-sm font-semibold tracking-tight text-zinc-100">
          Imposta budget
        </h3>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <select
            className={inputCls}
            value={periodType}
            onChange={(e) => setPeriodType(e.target.value as "monthly" | "annual")}
          >
            <option value="monthly">Mensile</option>
            <option value="annual">Annuale</option>
          </select>

          {periodType === "monthly" ? (
            <input
              type="month"
              className={inputCls}
              value={monthPeriod}
              onChange={(e) => setMonthPeriod(e.target.value)}
              required
            />
          ) : (
            <input
              type="number"
              min="2000"
              max="2100"
              className={inputCls}
              value={yearPeriod}
              onChange={(e) => setYearPeriod(e.target.value)}
              placeholder="Anno (es. 2026)"
              required
            />
          )}

          <input
            type="number"
            min="0"
            step="0.01"
            className={inputCls}
            value={budgetAmount}
            onChange={(e) => setBudgetAmount(e.target.value)}
            placeholder="Importo €"
            required
          />
        </div>
        <div className="mt-3 flex items-center gap-3">
          <button type="submit" disabled={budgetBusy} className="btn-primary">
            {budgetBusy ? "Salvataggio…" : "Imposta budget"}
          </button>
          <MsgBox msg={budgetMsg} />
        </div>
      </form>

      {/* Deposito */}
      <form onSubmit={handleDeposit} className="card p-5">
        <h3 className="text-sm font-semibold tracking-tight text-zinc-100">
          Aggiungi fondi
        </h3>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <input
            type="number"
            min="0"
            step="0.01"
            className={inputCls}
            value={depositAmount}
            onChange={(e) => setDepositAmount(e.target.value)}
            placeholder="Importo €"
            required
          />
          <input
            className={inputCls}
            value={depositNote}
            onChange={(e) => setDepositNote(e.target.value)}
            placeholder="Nota (opzionale)"
          />
        </div>
        <div className="mt-3 flex items-center gap-3">
          <button type="submit" disabled={depositBusy} className="btn-success">
            {depositBusy ? "Salvataggio…" : "Aggiungi fondi"}
          </button>
          <MsgBox msg={depositMsg} />
        </div>
      </form>

      {/* Prelievo */}
      <form onSubmit={handleWithdraw} className="card p-5">
        <h3 className="text-sm font-semibold tracking-tight text-zinc-100">
          Registra prelievo
        </h3>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <input
            type="number"
            min="0"
            step="0.01"
            className={inputCls}
            value={withdrawAmount}
            onChange={(e) => setWithdrawAmount(e.target.value)}
            placeholder="Importo €"
            required
          />
          <input
            className={inputCls}
            value={withdrawNote}
            onChange={(e) => setWithdrawNote(e.target.value)}
            placeholder="Nota (opzionale)"
          />
        </div>
        <div className="mt-3 flex items-center gap-3">
          <button
            type="submit"
            disabled={withdrawBusy}
            className="rounded-lg bg-rose-500 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-rose-400 disabled:opacity-60"
          >
            {withdrawBusy ? "Salvataggio…" : "Registra prelievo"}
          </button>
          <MsgBox msg={withdrawMsg} />
        </div>
      </form>
    </div>
  );
}
