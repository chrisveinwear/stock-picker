"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const links = [
  { href: "/", label: "Dashboard", icon: "⬛" },
  { href: "/research", label: "Research", icon: "📋" },
  { href: "/picks", label: "Action Alerts", icon: "🔔" },
  { href: "/watchlist", label: "Watchlist", icon: "👁" },
  { href: "/portfolio", label: "Portfolio", icon: "💼" },
  { href: "/metals", label: "Metals", icon: "◆" },
];

export default function Nav() {
  const pathname = usePathname();
  return (
    <nav className="w-52 border-r border-zinc-800 bg-zinc-900 flex flex-col p-4 gap-1 shrink-0">
      <div className="mb-6 px-2">
        <h1 className="text-sm font-bold text-zinc-100 tracking-tight">Stock Picker</h1>
        <p className="text-xs text-zinc-500 mt-0.5">ASX Value Investor</p>
      </div>
      {links.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          className={cn(
            "flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors",
            pathname === l.href || (l.href !== "/" && pathname.startsWith(l.href))
              ? "bg-zinc-800 text-zinc-100 font-medium"
              : "text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/50"
          )}
        >
          <span className="text-base">{l.icon}</span>
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
