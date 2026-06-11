import { defaultTenantBranding } from "@/branding/tenant-branding";

export function NewlLogo({
  compact = false,
  inverse = false
}: {
  compact?: boolean;
  inverse?: boolean;
}) {
  return (
    <div className="flex items-center gap-3">
      <div
        className={[
          "flex shrink-0 items-center justify-center rounded-md bg-primary font-semibold tracking-tight text-primaryForeground",
          compact ? "h-9 w-9 text-sm" : "h-12 w-12 text-base"
        ].join(" ")}
        aria-hidden="true"
      >
        {defaultTenantBranding.mark}
      </div>
      {!compact ? (
        <div>
          <p className={inverse ? "text-lg font-semibold text-sidebarForeground" : "text-xl font-semibold text-foreground"}>
            {defaultTenantBranding.wordmark}
          </p>
          <p className={inverse ? "text-xs font-medium uppercase tracking-wide text-sidebarMuted" : "text-xs font-medium uppercase tracking-wide text-mutedForeground"}>
            {defaultTenantBranding.tagline}
          </p>
        </div>
      ) : (
        <div>
          <p className="text-lg font-semibold text-sidebarForeground">{defaultTenantBranding.name}</p>
          <p className="text-xs font-medium uppercase tracking-wide text-sidebarMuted">Internal Platform</p>
        </div>
      )}
    </div>
  );
}
