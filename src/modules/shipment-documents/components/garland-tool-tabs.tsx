import Link from "next/link";

const tabs = [
  { href: "/shipment-documents", label: "BOL Consolidation" },
  { href: "/shipment-documents/carrier-manifests", label: "Carrier Manifests" },
  { href: "/shipment-documents/teamship-review", label: "Teamship Review" },
  { href: "/shipment-documents/teamship-review/bot-runs", label: "Bot Runs" }
];

export function GarlandToolTabs({ active }: { active: "bol" | "carrier-manifests" | "teamship-review" | "teamship-bot-runs" }) {
  return (
    <div className="flex flex-wrap gap-2 rounded-lg border border-border bg-card p-2 shadow-sm">
      {tabs.map((tab) => {
        const isActive =
          (active === "bol" && tab.href === "/shipment-documents") ||
          (active === "carrier-manifests" && tab.href.includes("carrier-manifests")) ||
          (active === "teamship-review" && tab.href === "/shipment-documents/teamship-review") ||
          (active === "teamship-bot-runs" && tab.href.includes("bot-runs"));

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
