"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { defaultTenantBranding } from "@/branding/tenant-branding";

const navItems = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/lead-gen/candidates", label: "Candidates" },
  { href: "/lead-gen/pipeline", label: "Pipeline" },
  { href: "/operations/logs", label: "Jobs & Audit" },
  { href: "/settings", label: "Settings" }
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen bg-background lg:flex">
      <aside className="border-b border-border bg-sidebar text-sidebarForeground lg:fixed lg:inset-y-0 lg:w-64 lg:border-b-0 lg:border-r">
        <div className="flex h-16 items-center gap-3 border-b border-sidebarForeground/10 px-5">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-accent text-sm font-semibold text-accentForeground">
            {defaultTenantBranding.mark}
          </div>
          <div>
            <p className="text-lg font-semibold text-sidebarForeground">{defaultTenantBranding.name}</p>
            <p className="text-xs font-medium uppercase tracking-wide text-sidebarMuted">Internal Platform</p>
          </div>
        </div>
        <nav className="flex gap-1 overflow-x-auto p-3 lg:block lg:space-y-1 lg:overflow-visible">
          {navItems.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);

            return (
              <Link
                key={item.href}
                href={item.href}
                className={[
                  "block whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-primary text-primaryForeground shadow-sm"
                    : "text-sidebarMuted hover:bg-sidebarForeground/10 hover:text-sidebarForeground"
                ].join(" ")}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </aside>
      <main className="min-w-0 flex-1 p-4 sm:p-6 lg:ml-64 lg:p-8">{children}</main>
    </div>
  );
}
