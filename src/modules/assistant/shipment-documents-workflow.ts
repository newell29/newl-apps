import { AssistantSourceKind, ModuleKey } from "@prisma/client";

import { AuthorizationError, requireModule } from "@/server/auth/authorization";
import { prisma } from "@/server/db";
import type { AuthenticatedContext } from "@/server/tenant-context";

const DEFAULT_BUSINESS_TIMEZONE = "America/Toronto";

export type AssistantShipmentDocumentsResponse = {
  answer: string;
  sources: Array<{
    sourceKind: AssistantSourceKind;
    sourceId: string | null;
    title: string;
    excerpt: string;
    metadata?: Record<string, unknown>;
  }>;
  intent: string;
  provider: string;
  model: string;
  messageMetadata: Record<string, unknown>;
  runMetadata: Record<string, unknown>;
};

export async function maybeRunAssistantShipmentDocumentsRequest(
  context: AuthenticatedContext,
  prompt: string
): Promise<AssistantShipmentDocumentsResponse | null> {
  const request = parseGarlandShipmentCountRequest(prompt);
  if (!request) {
    return null;
  }

  try {
    await requireModule(context, ModuleKey.SHIPMENT_DOCUMENTS);
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return {
        answer: "You do not currently have access to the Shipment Documents module for Garland shipment questions.",
        sources: [],
        intent: "SHIPMENT_DOCUMENTS",
        provider: "NEWL_SHIPMENT_DOCUMENTS",
        model: "assistant-shipment-documents-v1",
        messageMetadata: {
          deterministic: true,
          intent: "SHIPMENT_DOCUMENTS",
          shipmentDocumentsHandled: true,
          blocked: "unauthorized"
        },
        runMetadata: {
          deterministic: true,
          intent: "SHIPMENT_DOCUMENTS",
          shipmentDocumentsHandled: true,
          complete: true,
          blocked: "unauthorized"
        }
      };
    }

    throw error;
  }

  const shipmentDate = parseShipmentDate(request.dateLabel);
  const shipmentCount = await prisma.teamshipSyncedOrder.count({
    where: {
      tenantId: context.tenantId,
      shipmentDate
    }
  });

  const datePhrase = request.label === "today" || request.label === "yesterday"
    ? `${request.label} (${request.dateLabel}, ${request.timezone})`
    : `on ${request.dateLabel} (${request.timezone})`;
  return {
    answer: `Garland has ${shipmentCount} Teamship shipment${shipmentCount === 1 ? "" : "s"} from automatically processed Garland emails for ${datePhrase}.`,
    sources: [
      {
        sourceKind: AssistantSourceKind.OTHER,
        sourceId: `garland-email-orders:${request.dateLabel}`,
        title: "Garland email order count",
        excerpt: `${shipmentCount} Teamship orders from automatically processed Garland emails for ${request.dateLabel}.`,
        metadata: {
          module: "SHIPMENT_DOCUMENTS",
          tenantId: context.tenantId,
          shipmentDate: request.dateLabel,
          source: "garland-email-intake"
        }
      }
    ],
    intent: "SHIPMENT_DOCUMENTS",
    provider: "NEWL_SHIPMENT_DOCUMENTS",
    model: "assistant-shipment-documents-v1",
    messageMetadata: {
      deterministic: true,
      intent: "SHIPMENT_DOCUMENTS",
      shipmentDocumentsHandled: true,
      shipmentDate: request.dateLabel,
      shipmentCount
    },
    runMetadata: {
      deterministic: true,
      intent: "SHIPMENT_DOCUMENTS",
      shipmentDocumentsHandled: true,
      complete: true,
      toolIntent: "garland-shipment-count",
      shipmentDate: request.dateLabel,
      shipmentCount,
      source: "garland-email-intake"
    }
  };
}

function parseGarlandShipmentCountRequest(prompt: string) {
  const lower = prompt.toLowerCase();
  if (!/\bgarland\b/.test(lower) || !/\b(shipments?|orders?|loads?)\b/.test(lower)) {
    return null;
  }

  if (!/\b(how many|count|number of|total)\b/.test(lower)) {
    return null;
  }

  return parseDateReference(prompt);
}

function parseDateReference(prompt: string) {
  const timezone = DEFAULT_BUSINESS_TIMEZONE;
  const todayLabel = formatDateLabel(new Date(), timezone);
  const lower = prompt.toLowerCase();

  if (/\byesterday\b/.test(lower)) {
    return {
      dateLabel: shiftDateLabel(todayLabel, -1),
      label: "yesterday",
      timezone
    };
  }

  const explicitDate = parseExplicitDateLabel(prompt, todayLabel);
  if (explicitDate) {
    return {
      dateLabel: explicitDate,
      label: "on",
      timezone
    };
  }

  return {
    dateLabel: todayLabel,
    label: "today",
    timezone
  };
}

function parseShipmentDate(label: string) {
  const [year, month, day] = label.split("-").map((value) => Number.parseInt(value, 10));
  return new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
}

function formatDateLabel(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return year && month && day ? `${year}-${month}-${day}` : date.toISOString().slice(0, 10);
}

function parseExplicitDateLabel(prompt: string, todayLabel: string) {
  const isoMatch = prompt.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  }

  const slashMatch = prompt.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(20\d{2}))?\b/);
  if (!slashMatch) {
    return null;
  }

  const month = Number.parseInt(slashMatch[1], 10);
  const day = Number.parseInt(slashMatch[2], 10);
  const year = slashMatch[3] ? Number.parseInt(slashMatch[3], 10) : Number.parseInt(todayLabel.slice(0, 4), 10);

  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }

  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function shiftDateLabel(label: string, days: number) {
  const [year, month, day] = label.split("-").map((value) => Number.parseInt(value, 10));
  const shifted = new Date(Date.UTC(year, month - 1, day + days, 12, 0, 0, 0));
  return shifted.toISOString().slice(0, 10);
}
