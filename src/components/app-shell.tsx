"use client";

import type { ModuleKey, PlatformRole } from "@prisma/client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { NewlLogo } from "@/components/newl-logo";
import { signOutAction } from "@/server/auth/actions";

type NavEntry = {
  id: string;
  href: string;
  label: string;
  moduleKey?: ModuleKey;
  children?: never;
};

type NavGroup = {
  id: string;
  label: string;
  moduleKey?: ModuleKey;
  children: NavNode[];
};

type NavNode = NavEntry | NavGroup;

const navEntries: NavNode[] = [
  { id: "dashboard", href: "/dashboard", label: "Dashboard" },
  { id: "assistant", href: "/assistant", label: "Company Assistant", moduleKey: "ASSISTANT" as ModuleKey },
  {
    id: "sales",
    label: "Sales",
    children: [
      {
        id: "trademining",
        label: "TradeMining",
        moduleKey: "LEAD_GEN" as ModuleKey,
        children: [
          { id: "lead-search-profiles", href: "/lead-gen/search-profiles", label: "Search Profiles", moduleKey: "LEAD_GEN" as ModuleKey },
          { id: "lead-candidates", href: "/lead-gen/candidates", label: "Found Companies", moduleKey: "LEAD_GEN" as ModuleKey },
          { id: "lead-pipeline", href: "/lead-gen/pipeline", label: "Pipeline", moduleKey: "LEAD_GEN" as ModuleKey },
          { id: "lead-contacts", href: "/lead-gen/contacts", label: "Contacts", moduleKey: "LEAD_GEN" as ModuleKey },
          { id: "lead-logs", href: "/operations/logs", label: "Health & Logs", moduleKey: "LEAD_GEN" as ModuleKey }
        ]
      },
      { id: "website-inbound", href: "/website-inbound", label: "Website Inbound", moduleKey: "WEBSITE_INBOUND" as ModuleKey }
    ]
  },
  {
    id: "operations",
    label: "Operations Tools",
    children: [
      {
        id: "garland",
        label: "Garland",
        moduleKey: "SHIPMENT_DOCUMENTS" as ModuleKey,
        children: [
          {
            id: "garland-bol-consolidation",
            href: "/shipment-documents",
            label: "BOL Consolidation",
            moduleKey: "SHIPMENT_DOCUMENTS" as ModuleKey
          }
        ]
      },
      { id: "ups-tools", href: "/ups-tools", label: "UPS Tools", moduleKey: "UPS_TOOLS" as ModuleKey },
      { id: "ltl-rate-portal", href: "/ltl-rate-portal", label: "LTL Rate Portal", moduleKey: "LTL_RATE_PORTAL" as ModuleKey },
      { id: "transit-lookup", href: "/transit-lookup", label: "Transit Lookup", moduleKey: "TRANSIT_LOOKUP" as ModuleKey }
    ]
  },
  {
    id: "finance",
    label: "Finance",
    children: [
      { id: "customer-cashflow", href: "/finance/customer-cashflow", label: "Customer Cashflow", moduleKey: "CUSTOMER_CASHFLOW" as ModuleKey },
      { id: "collections-queue", href: "/finance/customer-cashflow/collections", label: "Collections Queue", moduleKey: "CUSTOMER_CASHFLOW" as ModuleKey },
      { id: "credit-checks", href: "/finance/credit-checks", label: "Credit Checks", moduleKey: "CUSTOMER_CASHFLOW" as ModuleKey },
      { id: "credit-settings", href: "/finance/customer-cashflow/settings", label: "Credit Settings", moduleKey: "CUSTOMER_CASHFLOW" as ModuleKey }
    ]
  },
  { id: "settings", href: "/settings", label: "Settings" }
];

function formatRole(role: PlatformRole) {
  return role
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function AppShell({
  children,
  userName,
  userEmail,
  role,
  tenantName,
  enabledModuleKeys
}: {
  children: ReactNode;
  userName?: string | null;
  userEmail?: string;
  role?: PlatformRole;
  tenantName?: string;
  enabledModuleKeys?: ModuleKey[];
}) {
  const pathname = usePathname();
  const displayName = userName?.trim() || userEmail || "Signed in";
  const [expandedNavIds, setExpandedNavIds] = useState<Record<string, boolean>>({});
  const visibleNavEntries = useMemo(
    () => filterVisibleNavEntries(navEntries, enabledModuleKeys),
    [enabledModuleKeys]
  );

  useEffect(() => {
    setExpandedNavIds((current) => {
      const next = { ...current };
      openActiveNavGroups(visibleNavEntries, pathname, next);
      return next;
    });
  }, [pathname, visibleNavEntries]);

  function toggleNavGroup(entry: NavGroup) {
    const isOpen = expandedNavIds[entry.id] ?? isNavNodeActive(entry, pathname);
    setExpandedNavIds((current) => ({
      ...current,
      [entry.id]: !isOpen
    }));
  }

  return (
    <div className="min-h-screen bg-background lg:flex">
      <aside className="flex flex-col border-b border-border bg-sidebar text-sidebarForeground lg:fixed lg:inset-y-0 lg:w-64 lg:border-b-0 lg:border-r">
        <div className="flex h-16 items-center gap-3 border-b border-sidebarForeground/10 bg-sidebarStrong px-5">
          <NewlLogo compact inverse />
        </div>
        <nav className="p-3 lg:flex-1">
          <NavTree
            entries={visibleNavEntries}
            expandedNavIds={expandedNavIds}
            pathname={pathname}
            onToggleGroup={toggleNavGroup}
          />
        </nav>
        {tenantName || role || userEmail ? (
          <div className="border-t border-sidebarForeground/10 p-3 lg:mt-auto">
            <div className="rounded-md bg-sidebarStrong/60 px-3 py-3">
              {tenantName ? (
                <p className="truncate text-xs font-semibold uppercase tracking-wide text-sidebarMuted">
                  {tenantName}
                </p>
              ) : null}
              <p className="mt-1 truncate text-sm font-medium text-sidebarForeground" title={userEmail}>
                {displayName}
              </p>
              {role ? (
                <span className="mt-2 inline-block rounded-full bg-sidebarActive px-2 py-0.5 text-xs font-semibold text-primaryForeground">
                  {formatRole(role)}
                </span>
              ) : null}
              <form action={signOutAction} className="mt-3">
                <button
                  type="submit"
                  className="w-full rounded-md border border-sidebarForeground/20 px-3 py-1.5 text-xs font-semibold text-sidebarMuted transition-colors hover:bg-sidebarHover hover:text-sidebarForeground"
                >
                  Sign out
                </button>
              </form>
            </div>
          </div>
        ) : null}
      </aside>
      <main className="min-w-0 flex-1 p-4 sm:p-6 lg:ml-64 lg:p-8">{children}</main>
    </div>
  );
}

function NavTree({
  entries,
  expandedNavIds,
  pathname,
  onToggleGroup,
  depth = 0
}: {
  entries: NavNode[];
  expandedNavIds: Record<string, boolean>;
  pathname: string;
  onToggleGroup: (entry: NavGroup) => void;
  depth?: number;
}) {
  return (
    <div className={depth === 0 ? "space-y-1" : "space-y-1"}>
      {entries.map((entry) => {
        const isActive = isNavNodeActive(entry, pathname);
        const paddingLeft = 12 + depth * 12;

        if (isNavGroup(entry)) {
          const isOpen = expandedNavIds[entry.id] ?? isActive;

          return (
            <div key={entry.id} className="space-y-1">
              <button
                type="button"
                onClick={() => onToggleGroup(entry)}
                aria-expanded={isOpen}
                className={[
                  "flex w-full items-center justify-between rounded-md py-2 pr-3 text-left transition-colors",
                  depth === 0 ? "text-xs font-semibold uppercase tracking-wide" : "text-sm font-semibold",
                  isActive
                    ? "bg-sidebarHover text-sidebarForeground"
                    : "text-sidebarMuted hover:bg-sidebarHover hover:text-sidebarForeground"
                ].join(" ")}
                style={{ paddingLeft }}
              >
                <span>{entry.label}</span>
                <span
                  aria-hidden="true"
                  className={["text-xs transition-transform", isOpen ? "rotate-90" : ""].join(" ")}
                >
                  &gt;
                </span>
              </button>
              {isOpen ? (
                <NavTree
                  entries={entry.children}
                  expandedNavIds={expandedNavIds}
                  pathname={pathname}
                  onToggleGroup={onToggleGroup}
                  depth={depth + 1}
                />
              ) : null}
            </div>
          );
        }

        return (
          <Link
            key={entry.id}
            href={entry.href}
            className={[
              "block rounded-md py-2 pr-3 text-sm font-medium transition-colors",
              isActive
                ? "bg-sidebarActive text-primaryForeground shadow-sm hover:bg-primaryHover"
                : "text-sidebarMuted hover:bg-sidebarHover hover:text-sidebarForeground"
            ].join(" ")}
            style={{ paddingLeft }}
          >
            {entry.label}
          </Link>
        );
      })}
    </div>
  );
}

function filterVisibleNavEntries(entries: NavNode[], enabledModuleKeys?: ModuleKey[]): NavNode[] {
  const visibleEntries: NavNode[] = [];

  for (const entry of entries) {
    if (isNavGroup(entry)) {
      const children = filterVisibleNavEntries(entry.children, enabledModuleKeys);
      if (children.length > 0) {
        visibleEntries.push({ ...entry, children });
      }
      continue;
    }

    if (entry.moduleKey && !enabledModuleKeys?.includes(entry.moduleKey)) {
      continue;
    }

    visibleEntries.push(entry);
  }

  return visibleEntries;
}

function isNavNodeActive(entry: NavNode, pathname: string): boolean {
  if (isNavGroup(entry)) {
    return entry.children.some((child) => isNavNodeActive(child, pathname));
  }

  return pathname === entry.href || pathname.startsWith(`${entry.href}/`);
}

function openActiveNavGroups(entries: NavNode[], pathname: string, expandedNavIds: Record<string, boolean>) {
  for (const entry of entries) {
    if (!isNavGroup(entry)) {
      continue;
    }

    if (isNavNodeActive(entry, pathname)) {
      expandedNavIds[entry.id] = true;
      openActiveNavGroups(entry.children, pathname, expandedNavIds);
    }
  }
}

function isNavGroup(entry: NavNode): entry is NavGroup {
  return Array.isArray(entry.children);
}
