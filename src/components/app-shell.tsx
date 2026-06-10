import Link from "next/link";

const navItems = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/lead-gen/candidates", label: "Candidates" },
  { href: "/lead-gen/pipeline", label: "Pipeline" },
  { href: "/operations/logs", label: "Jobs & Audit" },
  { href: "/settings", label: "Settings" }
];

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen lg:flex">
      <aside className="border-b border-line bg-white lg:fixed lg:inset-y-0 lg:w-64 lg:border-b-0 lg:border-r">
        <div className="flex h-16 items-center border-b border-line px-5">
          <div>
            <p className="text-lg font-semibold text-ink">Newl Apps</p>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Internal Platform</p>
          </div>
        </div>
        <nav className="flex gap-1 overflow-x-auto p-3 lg:block lg:space-y-1 lg:overflow-visible">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="block whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium text-slate-700 hover:bg-panel hover:text-ink"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </aside>
      <main className="min-w-0 flex-1 p-4 sm:p-6 lg:ml-64 lg:p-8">{children}</main>
    </div>
  );
}
