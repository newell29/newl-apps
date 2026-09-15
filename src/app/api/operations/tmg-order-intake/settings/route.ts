import { ModuleKey } from "@prisma/client";
import { NextResponse } from "next/server";

import {
  getTmgOrderIntakeSettings,
  saveTmgOrderIntakeSettings,
  type TmgOrderIntakeSettingsInput
} from "@/modules/shipment-documents/tmg-settings";
import { AuthorizationError, requireAdmin, requireModule, requireMutationAccess } from "@/server/auth/authorization";
import { getAuthenticatedContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

export async function GET() {
  const context = await getAuthenticatedContext();
  await requireModule(context, ModuleKey.SHIPMENT_DOCUMENTS);
  return NextResponse.json({ settings: await getTmgOrderIntakeSettings(context.tenantId) });
}

export async function POST(request: Request) {
  try {
    const context = await getAuthenticatedContext();
    await requireModule(context, ModuleKey.SHIPMENT_DOCUMENTS);
    await requireMutationAccess(context);
    requireAdmin(context);
    const body = await request.json().catch(() => null);
    const input = parseSettingsInput(body);
    const settings = await saveTmgOrderIntakeSettings({ tenantId: context.tenantId, actorUserId: context.userId, input });
    return NextResponse.json({ settings });
  } catch (error) {
    const status = error instanceof AuthorizationError ? error.status : 400;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to save TMG order-intake settings." },
      { status }
    );
  }
}

function parseSettingsInput(value: unknown): TmgOrderIntakeSettingsInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("TMG settings payload is required.");
  const record = value as Record<string, unknown>;
  const teamship = readRecord(record.teamship);
  if (!teamship) throw new Error("TMG Teamship profile is required.");
  return {
    enabled: record.enabled === true,
    mailboxAddress: readString(record.mailboxAddress),
    allowedSenderAddresses: readStringArray(record.allowedSenderAddresses),
    requiredRecipientAddresses: readStringArray(record.requiredRecipientAddresses),
    additionalInternalRecipientDomains: readStringArray(record.additionalInternalRecipientDomains),
    subjectPrefix: readString(record.subjectPrefix),
    lookbackDays: readNumber(record.lookbackDays),
    maxMessagesPerScan: readNumber(record.maxMessagesPerScan),
    internalSummaryRecipients: readStringArray(record.internalSummaryRecipients),
    teamship: {
      customerId: readString(teamship.customerId),
      customerName: readString(teamship.customerName),
      warehouseId: readString(teamship.warehouseId),
      warehouseName: readString(teamship.warehouseName),
      inventoryUserId: readString(teamship.inventoryUserId),
      inventoryLocationId: readString(teamship.inventoryLocationId),
      carrierName: readString(teamship.carrierName)
    }
  };
}

function readRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function readStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function readNumber(value: unknown) {
  return typeof value === "number" ? value : typeof value === "string" ? Number.parseInt(value, 10) : Number.NaN;
}
