import { IntegrationProvider, IntegrationStatus } from "@prisma/client";
import type { ManagedQuoteSource, QuoteSourceDirectoryEntry, QuoteToolTarget } from "@/modules/settings/types";

export const QUOTE_SOURCE_DIRECTORY_NAME = "__QUOTE_SOURCE_DIRECTORY__";

const QUOTE_TOOL_TARGETS = ["SHIPMENT_RATE_QUOTE", "PROSPECT_QUOTE"] satisfies QuoteToolTarget[];

export function parseQuoteToolTargets(value: unknown): QuoteToolTarget[] {
  if (!Array.isArray(value)) {
    return [...QUOTE_TOOL_TARGETS];
  }

  const targets = value.filter((item): item is QuoteToolTarget =>
    typeof item === "string" && QUOTE_TOOL_TARGETS.includes(item as QuoteToolTarget)
  );

  return targets.length > 0 ? targets : [...QUOTE_TOOL_TARGETS];
}

export function quoteSourceSupportsTarget(
  source: Pick<ManagedQuoteSource | QuoteSourceDirectoryEntry, "toolTargets">,
  target: QuoteToolTarget
) {
  return source.toolTargets.includes(target);
}

export function parseQuoteSourceDirectory(publicConfig: unknown): QuoteSourceDirectoryEntry[] {
  if (!publicConfig || typeof publicConfig !== "object") {
    return [];
  }

  const config = publicConfig as Record<string, unknown>;
  if (!Array.isArray(config.quoteSources)) {
    return [];
  }

  return config.quoteSources
    .map((entry) => parseQuoteSourceDirectoryEntry(entry))
    .filter((entry): entry is QuoteSourceDirectoryEntry => entry !== null);
}

function parseQuoteSourceDirectoryEntry(value: unknown): QuoteSourceDirectoryEntry | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const entry = value as Record<string, unknown>;
  const id = typeof entry.id === "string" ? entry.id : null;
  const displayName = typeof entry.displayName === "string" ? entry.displayName : null;
  const carrierName = typeof entry.carrierName === "string" ? entry.carrierName : null;
  const carrierCode = typeof entry.carrierCode === "string" ? entry.carrierCode : null;

  if (!id || !displayName || !carrierName || !carrierCode) {
    return null;
  }

  return {
    id,
    displayName,
    carrierName,
    carrierCode,
    status: parseIntegrationStatus(entry.status),
    readiness: "planned",
    toolTargets: parseQuoteToolTargets(entry.toolTargets),
    notes: typeof entry.notes === "string" ? entry.notes : undefined
  };
}

export function buildPlaceholderQuoteSource(entry: QuoteSourceDirectoryEntry): ManagedQuoteSource {
  return {
    ...entry,
    provider: "CUSTOM",
    selectable: false,
    sourceKind: "CARRIER_PLACEHOLDER"
  };
}

export function parseIntegrationStatus(value: unknown): IntegrationStatus {
  return value === IntegrationStatus.ACTIVE || value === IntegrationStatus.ERROR ? value : IntegrationStatus.DISABLED;
}

export function buildQuoteSourceDirectoryConfig(entries: QuoteSourceDirectoryEntry[]) {
  return {
    kind: "QUOTE_SOURCE_DIRECTORY",
    quoteSources: entries
  };
}

export function mapProviderToCarrierName(provider: IntegrationProvider) {
  switch (provider) {
    case IntegrationProvider.UPS:
      return "UPS";
    case IntegrationProvider.SEVEN_L:
      return "7L";
    default:
      return provider.replaceAll("_", " ");
  }
}
