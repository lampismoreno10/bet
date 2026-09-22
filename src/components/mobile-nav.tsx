"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/dashboard", label: "Oggi" },
  { href: "/archive", label: "Archivio" },
  { href: "/stats", label: "Statistiche" },
  { href: "/budget", label: "Budget" },
];

export function MobileNav() {
  const pathname = usePathname();

  return (
    <nav className="flex gap-1 overflow-x-auto border-b border-white/[0.06] bg-zinc-950 px-3 py-2 md:hidden">
      {LINKS.map((link) => {
        const active =
          pathname === link.href ||
          (link.href !== "/dashboard" && pathname.startsWith(link.href));
        return (
          <Link
            key={link.href}
            href={link.href}
            className={`whitespace-nowrap rounded-full px-3 py-1 text-sm font-medium transition ${
              active
                ? "bg-indigo-500 text-white"
                : "text-zinc-400 hover:bg-white/5 hover:text-zinc-100"
            }`}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
