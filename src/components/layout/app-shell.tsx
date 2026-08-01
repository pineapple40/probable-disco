"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { postJson } from "@/lib/api-client";
import type { AuthenticatedUser } from "@/server/auth/session";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/watchlists", label: "Watchlists" },
  { href: "/charts", label: "Charts" },
  { href: "/scanner", label: "Scanner" },
  { href: "/strategies", label: "Strategies" },
  { href: "/backtests", label: "Backtests" },
  { href: "/journal", label: "Journal" },
  { href: "/analytics", label: "Analytics" },
  { href: "/alerts", label: "Alerts" },
  { href: "/settings/security", label: "Settings" },
];

export function AppShell({
  user,
  children,
}: {
  user: AuthenticatedUser;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const isAdmin = user.role.key === "admin";

  async function onLogout() {
    await postJson("/api/auth/logout", {});
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="border-b border-amber-900/40 bg-amber-950/40 px-4 py-1.5 text-center text-xs font-medium text-amber-300">
        SIMULATED PAPER TRADING — market data is generated locally, not real-time. No real money is
        ever at risk.
      </div>
      <div className="flex">
        <aside className="hidden w-56 shrink-0 border-r border-slate-800 p-4 md:block">
          <div className="mb-6 text-sm font-semibold">Probable Disco</div>
          <nav className="space-y-1">
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "block rounded-md px-3 py-2 text-sm text-slate-300 hover:bg-slate-800 hover:text-slate-100",
                  pathname?.startsWith(item.href) && "bg-slate-800 text-slate-100",
                )}
              >
                {item.label}
              </Link>
            ))}
            {isAdmin && (
              <Link
                href="/admin"
                className={cn(
                  "block rounded-md px-3 py-2 text-sm text-slate-300 hover:bg-slate-800 hover:text-slate-100",
                  pathname?.startsWith("/admin") && "bg-slate-800 text-slate-100",
                )}
              >
                Admin
              </Link>
            )}
          </nav>
        </aside>
        <div className="flex-1">
          <header className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
            <div className="text-sm text-slate-400">
              Signed in as <span className="text-slate-100">{user.displayName}</span>
            </div>
            <Button variant="outline" size="sm" onClick={onLogout}>
              Log out
            </Button>
          </header>
          <main className="p-4">{children}</main>
        </div>
      </div>
    </div>
  );
}
