import { ProphitBetImport } from "@/components/prophitbet-import";

export default function ProphitBetPage() {
  return (
    <div className="space-y-6">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-indigo-300">
          Modello esterno · anteprima
        </p>
        <h1 className="mt-2 text-2xl font-semibold text-zinc-100">ProphitBet</h1>
        <p className="mt-2 max-w-2xl text-sm text-zinc-400">
          Visualizza i pronostici esportati da ProphitBet e confronta le probabilita'
          prima di valutare una schedina. Non modifica le analisi attuali.
        </p>
      </header>
      <ProphitBetImport />
    </div>
  );
}
