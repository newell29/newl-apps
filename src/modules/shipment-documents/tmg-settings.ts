import { IntegrationProvider, IntegrationStatus, type Prisma } from "@prisma/client";

import type { TmgTeamshipProfile } from "@/modules/shipment-documents/tmg-teamship-create";
import { prisma } from "@/server/db";
import { parseMicrosoftGraphSettings } from "@/server/integrations/microsoft-graph";

export const TMG_ORDER_INTAKE_CREDENTIAL_NAME = "TMG Order Intake";

export type TmgOrderIntakeSettings = {
  enabled: boolean;
  mailboxAddress: string | null;
  allowedSenderAddresses: string[];
  requiredRecipientAddresses: string[];
  additionalInternalRecipientDomains: string[];
  subjectPrefix: string;
  lookbackDays: number;
  maxMessagesPerScan: number;
  internalSummaryRecipients: string[];
  teamship: TmgTeamshipProfile | null;
  configured: boolean;
  configurationIssues: string[];
};

export type TmgOrderIntakeSettingsInput = {
  enabled: boolean;
  mailboxAddress: string;
  allowedSenderAddresses: string[];
  requiredRecipientAddresses: string[];
  additionalInternalRecipientDomains: string[];
  subjectPrefix: string;
  lookbackDays: number;
  maxMessagesPerScan: number;
  internalSummaryRecipients: string[];
  teamship: TmgTeamshipProfile;
};

export async function getTmgOrderIntakeSettings(tenantId: string): Promise<TmgOrderIntakeSettings> {
  const credential = await prisma.integrationCredential.findFirst({
    where: {
      tenantId,
      provider: IntegrationProvider.TEAMSHIP,
      name: TMG_ORDER_INTAKE_CREDENTIAL_NAME
    },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    select: { status: true, publicConfig: true }
  });
  return parseTmgOrderIntakeSettings(credential);
}

export function parseTmgOrderIntakeSettings(credential?: { status: IntegrationStatus; publicConfig: unknown } | null) {
  const config = readRecord(credential?.publicConfig) ?? {};
  const teamshipConfig = readRecord(config.teamship);
  const teamship = teamshipConfig ? parseTeamshipProfile(teamshipConfig) : null;
  const settings = {
    enabled: credential?.status === IntegrationStatus.ACTIVE && config.enabled === true,
    mailboxAddress: readEmail(config.mailboxAddress),
    allowedSenderAddresses: readEmailArray(config.allowedSenderAddresses),
    requiredRecipientAddresses: readEmailArray(config.requiredRecipientAddresses),
    additionalInternalRecipientDomains: readDomainArray(config.additionalInternalRecipientDomains),
    subjectPrefix: readString(config.subjectPrefix) ?? "",
    lookbackDays: readInteger(config.lookbackDays, 14, 1, 90),
    maxMessagesPerScan: readInteger(config.maxMessagesPerScan, 50, 1, 250),
    internalSummaryRecipients: readEmailArray(config.internalSummaryRecipients),
    teamship
  };
  const configurationIssues = validateSettings(settings);
  return {
    ...settings,
    configured: configurationIssues.length === 0,
    configurationIssues
  } satisfies TmgOrderIntakeSettings;
}

export async function saveTmgOrderIntakeSettings({
  tenantId,
  actorUserId,
  input
}: {
  tenantId: string;
  actorUserId: string;
  input: TmgOrderIntakeSettingsInput;
}) {
  const normalized = normalizeSettingsInput(input);
  const issues = validateSettings(normalized);
  if (issues.length > 0) throw new Error(issues.join(" "));
  await assertMailboxIsTenantConfigured(tenantId, normalized.mailboxAddress!);
  assertInternalRecipients(
    normalized.mailboxAddress!,
    normalized.additionalInternalRecipientDomains,
    normalized.requiredRecipientAddresses,
    "required To/CC recipients"
  );
  assertInternalRecipients(
    normalized.mailboxAddress!,
    normalized.additionalInternalRecipientDomains,
    normalized.internalSummaryRecipients,
    "summary recipients"
  );
  const existing = await prisma.integrationCredential.findFirst({
    where: { tenantId, provider: IntegrationProvider.TEAMSHIP, name: TMG_ORDER_INTAKE_CREDENTIAL_NAME },
    select: { id: true, status: true, publicConfig: true }
  });
  const data = {
    status: normalized.enabled ? IntegrationStatus.ACTIVE : IntegrationStatus.DISABLED,
    publicConfig: {
      enabled: normalized.enabled,
      mailboxAddress: normalized.mailboxAddress,
      allowedSenderAddresses: normalized.allowedSenderAddresses,
      requiredRecipientAddresses: normalized.requiredRecipientAddresses,
      additionalInternalRecipientDomains: normalized.additionalInternalRecipientDomains,
      subjectPrefix: normalized.subjectPrefix,
      lookbackDays: normalized.lookbackDays,
      maxMessagesPerScan: normalized.maxMessagesPerScan,
      internalSummaryRecipients: normalized.internalSummaryRecipients,
      teamship: normalized.teamship,
      updatedAt: new Date().toISOString()
    } satisfies Prisma.InputJsonObject
  };
  const saved = existing
    ? await prisma.$transaction(async (transaction) => {
        const updated = await transaction.integrationCredential.updateMany({
          where: { id: existing.id, tenantId },
          data
        });
        if (updated.count !== 1) throw new Error("The tenant-scoped TMG configuration changed while it was being saved.");
        return transaction.integrationCredential.findFirstOrThrow({ where: { id: existing.id, tenantId } });
      })
    : await prisma.integrationCredential.create({
        data: {
          tenantId,
          provider: IntegrationProvider.TEAMSHIP,
          name: TMG_ORDER_INTAKE_CREDENTIAL_NAME,
          ...data
        }
      });
  await prisma.auditLog.create({
    data: {
      tenantId,
      actorUserId,
      action: "TMG_ORDER_INTAKE_SETTINGS_UPDATED",
      entityType: "IntegrationCredential",
      entityId: saved.id,
      before: existing ? { status: existing.status, configured: Boolean(existing.publicConfig) } : undefined,
      after: {
        enabled: normalized.enabled,
        mailboxConfigured: true,
        senderCount: normalized.allowedSenderAddresses.length,
        requiredRecipientCount: normalized.requiredRecipientAddresses.length,
        additionalInternalRecipientDomainCount: normalized.additionalInternalRecipientDomains.length,
        internalRecipientCount: normalized.internalSummaryRecipients.length,
        teamshipProfileConfigured: true
      }
    }
  });
  return parseTmgOrderIntakeSettings(saved);
}

function normalizeSettingsInput(input: TmgOrderIntakeSettingsInput) {
  return {
    enabled: input.enabled,
    mailboxAddress: readEmail(input.mailboxAddress),
    allowedSenderAddresses: readEmailArray(input.allowedSenderAddresses),
    requiredRecipientAddresses: readEmailArray(input.requiredRecipientAddresses),
    additionalInternalRecipientDomains: readDomainArray(input.additionalInternalRecipientDomains),
    subjectPrefix: readString(input.subjectPrefix) ?? "",
    lookbackDays: readInteger(input.lookbackDays, 14, 1, 90),
    maxMessagesPerScan: readInteger(input.maxMessagesPerScan, 50, 1, 250),
    internalSummaryRecipients: readEmailArray(input.internalSummaryRecipients),
    teamship: parseTeamshipProfile(input.teamship as unknown as Record<string, unknown>)
  };
}

function validateSettings(settings: {
  mailboxAddress: string | null;
  allowedSenderAddresses: string[];
  requiredRecipientAddresses: string[];
  additionalInternalRecipientDomains: string[];
  subjectPrefix: string;
  internalSummaryRecipients: string[];
  teamship: TmgTeamshipProfile | null;
}) {
  const issues: string[] = [];
  if (!settings.mailboxAddress) issues.push("A TMG mailbox address is required.");
  if (settings.allowedSenderAddresses.length === 0) issues.push("At least one exact TMG sender address is required.");
  if (settings.requiredRecipientAddresses.length === 0) issues.push("At least one exact TMG To/CC recipient address is required.");
  if (!settings.subjectPrefix.trim()) issues.push("A TMG subject prefix is required.");
  if (settings.internalSummaryRecipients.length === 0) issues.push("At least one internal TMG summary recipient is required.");
  if (settings.mailboxAddress && settings.requiredRecipientAddresses.length > 0) {
    try {
      assertInternalRecipients(
        settings.mailboxAddress,
        settings.additionalInternalRecipientDomains,
        settings.requiredRecipientAddresses,
        "required To/CC recipients"
      );
    } catch (error) {
      issues.push(error instanceof Error ? error.message : "TMG required To/CC recipients are not internal.");
    }
  }
  if (settings.mailboxAddress && settings.internalSummaryRecipients.length > 0) {
    try {
      assertInternalRecipients(
        settings.mailboxAddress,
        settings.additionalInternalRecipientDomains,
        settings.internalSummaryRecipients,
        "summary recipients"
      );
    } catch (error) {
      issues.push(error instanceof Error ? error.message : "TMG summary recipients are not internal.");
    }
  }
  if (!settings.teamship) issues.push("The TMG Teamship customer, warehouse, inventory user, location, and carrier profile is incomplete.");
  return issues;
}

async function assertMailboxIsTenantConfigured(tenantId: string, mailboxAddress: string) {
  const credential = await prisma.integrationCredential.findFirst({
    where: { tenantId, provider: IntegrationProvider.MICROSOFT_GRAPH, status: IntegrationStatus.ACTIVE },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    select: { provider: true, status: true, publicConfig: true }
  });
  const graph = parseMicrosoftGraphSettings(credential);
  if (!graph.adminMailboxTargets.some((mailbox) => mailbox.toLowerCase() === mailboxAddress.toLowerCase())) {
    throw new Error("The TMG mailbox must already be an active, tenant-configured Microsoft 365 mailbox target.");
  }
}

export function assertInternalRecipients(
  mailboxAddress: string,
  additionalDomains: string[],
  recipients: string[],
  label: string
) {
  const mailboxDomain = mailboxAddress.split("@")[1]?.toLowerCase();
  const allowedDomains = new Set([mailboxDomain, ...readDomainArray(additionalDomains)].filter(Boolean));
  if (
    !mailboxDomain ||
    recipients.some((recipient) => !allowedDomains.has(recipient.split("@")[1]?.toLowerCase()))
  ) {
    throw new Error(`TMG ${label} must use the mailbox domain or an explicitly approved additional internal domain.`);
  }
}

function parseTeamshipProfile(value: Record<string, unknown>): TmgTeamshipProfile | null {
  const fields = {
    customerId: readIdentifier(value.customerId),
    customerName: readString(value.customerName),
    warehouseId: readIdentifier(value.warehouseId),
    warehouseName: readString(value.warehouseName),
    inventoryUserId: readIdentifier(value.inventoryUserId),
    inventoryLocationId: readIdentifier(value.inventoryLocationId),
    carrierName: readString(value.carrierName)
  };
  return Object.values(fields).every(Boolean) ? fields as TmgTeamshipProfile : null;
}

function readRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readIdentifier(value: unknown) {
  const parsed = readString(String(value ?? ""));
  return parsed && /^\d+$/.test(parsed) ? parsed : null;
}

function readEmail(value: unknown) {
  const parsed = readString(value)?.toLowerCase() ?? null;
  return parsed && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(parsed) ? parsed : null;
}

function readEmailArray(value: unknown) {
  const candidates = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[\n,;]/) : [];
  return Array.from(new Set(candidates.map(readEmail).filter((entry): entry is string => Boolean(entry))));
}

function readDomainArray(value: unknown) {
  const candidates = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[\n,;]/) : [];
  return Array.from(new Set(candidates
    .map((entry) => readString(entry)?.toLowerCase() ?? null)
    .filter((entry): entry is string => Boolean(entry && /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(entry)))));
}

function readInteger(value: unknown, fallback: number, min: number, max: number) {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number.parseInt(value, 10) : Number.NaN;
  return Number.isInteger(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}
