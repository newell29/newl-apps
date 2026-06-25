"use client";

import type { ModuleKey, PlatformRole } from "@prisma/client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { NewlLogo } from "@/components/newl-logo";
import { signOutAction } from "@/server/auth/actions";

type NavLink = {
  href: string;
  label: string;
  moduleKey?: ModuleKey;
};

type NavSection = {
  label: string;
  href?: string;
  moduleKey?: ModuleKey;
  items?: NavLink[];
};

const navSections: NavSection[] = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/assistant", label: "Company Assistant", moduleKey: "ASSISTANT" as ModuleKey },
  {
    label: "TradeMining Leads",
    moduleKey: "LEAD_GEN" as ModuleKey,
    items: [
      { href: "/lead-gen/search-profiles", label: "Search Profiles", moduleKey: "LEAD_GEN" as ModuleKey },
      { href: "/lead-gen/candidates", label: "Found Companies", moduleKey: "LEAD_GEN" as ModuleKey },
      { href: "/lead-gen/pipeline", label: "Pipeline", moduleKey: "LEAD_GEN" as ModuleKey },
      { href: "/lead-gen/contacts", label: "Contacts", moduleKey: "LEAD_GEN" as ModuleKey },
      { href: "/operations/logs", label: "Health & Logs", moduleKey: "LEAD_GEN" as ModuleKey }
    ]
  },
  { href: "/ups-tools", label: "UPS Tools", moduleKey: "UPS_TOOLS" as ModuleKey },
  { href: "/ltl-rate-portal", label: "LTL Rate Portal", moduleKey: "LTL_RATE_PORTAL" as ModuleKey },
  { href: "/settings", label: "Settings" }
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
  children: React.ReactNode;
  userName?: string | null;
  userEmail?: string;
  role?: PlatformRole;
  tenantName?: string;
  enabledModuleKeys?: ModuleKey[];
}) {
  const pathname = usePathname();
  const displayName = userName?.trim() || userEmail || "Signed in";
  const visibleNavSections = navSections
    .map((section) => ({
      ...section,
      items: section.items?.filter((item) => !item.moduleKey || enabledModuleKeys?.includes(item.moduleKey))
    }))
    .filter((section) => {
      if (section.items) {
        return section.items.length > 0;
      }

      return !section.moduleKey || enabledModuleKeys?.includes(section.moduleKey);
    });

  return (
    <div className="min-h-screen bg-background lg:flex">
      <aside className="flex flex-col border-b border-border bg-sidebar text-sidebarForeground lg:fixed lg:inset-y-0 lg:w-64 lg:border-b-0 lg:border-r">
        <div className="flex h-16 items-center gap-3 border-b border-sidebarForeground/10 bg-sidebarStrong px-5">
          <NewlLogo compact inverse />
        </div>
        <nav className="p-3 lg:flex-1">
          <div className="space-y-3">
            {visibleNavSections.map((section) => {
              const sectionIsActive = section.href
                ? pathname === section.href || pathname.startsWith(`${section.href}/`)
                : section.items?.some((item) => pathname === item.href || pathname.startsWith(`${item.href}/`));

              if (section.items) {
                return (
                  <div key={section.label} className="space-y-1">
                    <div
                      className={[
                        "rounded-md px-3 py-2 text-xs font-semibold uppercase tracking-wide",
                        sectionIsActive ? "text-sidebarForeground" : "text-sidebarMuted"
                      ].join(" ")}
                    >
                      {section.label}
                    </div>
                    <div className="space-y-1">
                      {section.items.map((item) => {
                        const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);

                        return (
                          <Link
                            key={item.href}
                            href={item.href}
                            className={[
                              "block rounded-md px-3 py-2 pl-6 text-sm font-medium transition-colors",
                              isActive
                                ? "bg-sidebarActive text-primaryForeground shadow-sm hover:bg-primaryHover"
                                : "text-sidebarMuted hover:bg-sidebarHover hover:text-sidebarForeground"
                            ].join(" ")}
                          >
                            {item.label}
                          </Link>
                        );
                      })}
                    </div>
                  </div>
                );
              }

              return (
                <Link
                  key={section.href}
                  href={section.href!}
                  className={[
                    "block rounded-md px-3 py-2 text-sm font-medium transition-colors",
                    sectionIsActive
                      ? "bg-sidebarActive text-primaryForeground shadow-sm hover:bg-primaryHover"
                      : "text-sidebarMuted hover:bg-sidebarHover hover:text-sidebarForeground"
                  ].join(" ")}
                >
                  {section.label}
                </Link>
              );
            })}
          </div>
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
