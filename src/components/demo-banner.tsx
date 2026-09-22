export function DemoBanner() {
  return (
    <div className="border-b border-amber-500/20 bg-amber-500/10 px-4 py-2 text-center text-xs font-medium text-amber-300">
      MODALITÀ DEMO — stai visualizzando dati fittizi di esempio. Configura
      Supabase (vedi{" "}
      <code className="rounded bg-amber-500/20 px-1">.env.example</code>) per
      usare i tuoi dati reali.
    </div>
  );
}

export function DemoBadge() {
  return (
    <span className="inline-flex items-center rounded-full bg-amber-500/10 px-2.5 py-0.5 text-xs font-medium text-amber-300 ring-1 ring-inset ring-amber-500/20">
      DEMO
    </span>
  );
}
