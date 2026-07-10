import Link from "next/link";

const tabs = [
  { href: "/shipment-documents", label: "BOL Consolidation" },
  { href: "/shipment-documents/carrier-manifests", label: "Carrier Manifests" }
];

export function GarlandToolTabs({ active }: { active: "bol" | "carrier-manifests" }) {
  return (
    <div className="flex flex-wrap gap-2 rounded-lg border border-border bg-card p-2 shadow-sm">
      {tabs.map((tab) => {
        const isActive =
          (active === "bol" && tab.href === "/shipment-documents") ||
          (active === "carrier-manifests" && tab.href.includes("carrier-manifests"));

        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={[
              "rounded-md px-4 py-2 text-sm font-semibold transition-colors",
              isActive ? "bg-sidebarActive text-primaryForeground" : "text-mutedForeground hover:bg-muted hover:text-foreground"
            ].join(" ")}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
