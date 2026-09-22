export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="label mb-1.5 block">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-zinc-500">{hint}</span>}
    </label>
  );
}

export function FormNotice({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
      {children}
    </div>
  );
}

export function FormError({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
      {children}
    </div>
  );
}

export function FormSuccess({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
      {children}
    </div>
  );
}
