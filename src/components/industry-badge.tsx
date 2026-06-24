"use client";

export function IndustryBadge({
  primaryIndustry,
  secondaryIndustry,
  confidence
}: {
  primaryIndustry?: string | null;
  secondaryIndustry?: string | null;
  confidence?: number | null;
}) {
  if (!primaryIndustry) {
    return <span className="text-xs text-mutedForeground">Unclassified</span>;
  }

  return (
    <div className="space-y-1">
      <span className="inline-flex rounded-full border border-primary/20 bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">
        {primaryIndustry}
      </span>
      {secondaryIndustry ? <p className="text-xs text-mutedForeground">{secondaryIndustry}</p> : null}
      {typeof confidence === "number" && confidence > 0 ? (
        <p className="text-[11px] text-mutedForeground">{confidence}% confidence</p>
      ) : null}
    </div>
  );
}
