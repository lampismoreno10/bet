"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/dashboard", label: "Oggi" },
  { href: "/archive", label: "Archivio Giocate" },
  { href: "/stats", label: "Statistiche" },
  { href: "/budget", label: "Budget" },
];

export function ShellNav() {
  const pathname = usePathname();

  return (
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-60 flex-col border-r border-white/[0.06] bg-zinc-950 md:flex">
      <div className="flex h-16 items-center gap-3 border-b border-white/[0.06] px-5">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-500/15 text-indigo-300">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-4 w-4"
          >
            <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
            <polyline points="17 6 23 6 23 12" />
          </svg>
        </div>
        <div>
          <span className="block text-sm font-semibold tracking-tight text-zinc-100">
            Bet CRM
          </span>
          <span className="block text-[11px] text-zinc-500">
            Analisi &amp; giocate
          </span>
        </div>
      </div>

      <nav className="flex-1 space-y-1 px-3 py-4">
        {LINKS.map((link) => {
          const active =
            pathname === link.href ||
            (link.href !== "/dashboard" && pathname.startsWith(link.href));
          return (
            <Link
              key={link.href}
              href={link.href}
              className={`relative flex items-center rounded-lg px-3 py-2 text-sm font-medium transition ${
                active
                  ? "bg-indigo-500/10 text-indigo-200"
                  : "text-zinc-400 hover:bg-white/5 hover:text-zinc-100"
              }`}
            >
              {active && (
                <span className="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-indigo-400" />
              )}
              {link.label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-white/[0.06] px-5 py-3 text-[11px] text-zinc-600">
        CRM per betting
      </div>
    </aside>
  );
}
