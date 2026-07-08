import { JobStatus, OceanRateStatus, PlatformRole } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  oceanFreightSourceEmail: { findUnique: vi.fn(), upsert: vi.fn(), findMany: vi.fn() },
  automationJobRun: { create: vi.fn(), findMany: vi.fn() },
  auditLog: { create: vi.fn() },
  tenantModuleAccess: { findFirst: vi.fn() },
  tenantRoleModuleAccess: { findMany: vi.fn() },
  tenantRolePolicy: { findUnique: vi.fn() }
}));

vi.mock("@/server/db", () => ({ prisma: prismaMock }));

import { ModuleKey } from "@prisma/client";
import { requireModule } from "@/server/auth/authorization";
import {
  detectOceanFreightRateEmail,
  OCEAN_FREIGHT_EMAIL_INGESTION_JOB_TYPE,
  persistOceanFreightSourceEmails,
  triggerOceanFreightEmailIngestion
} from "@/modules/ocean-freight-pricing/ingestion";
import { getComputedOceanRateStatus, getOceanFreightJobsShell, getOceanFreightSourcesShell } from "@/modules/ocean-freight-pricing/queries";
import { resolveMicrosoftGraphMailboxMessagesPath } from "@/server/integrations/microsoft-graph-mail";

describe("ocean freight pricing status", () => {
  const today = new Date("2026-07-07T12:00:00.000Z");

  it("treats active rates with past validity end as expired at query time", () => {
    expect(getComputedOceanRateStatus({ status: OceanRateStatus.ACTIVE, validityStartDate: null, validityEndDate: new Date("2026-07-06T00:00:00.000Z") }, today)).toBe(OceanRateStatus.EXPIRED);
  });

  it("keeps inactive rates inactive regardless of validity", () => {
    expect(getComputedOceanRateStatus({ status: OceanRateStatus.INACTIVE, validityStartDate: null, validityEndDate: new Date("2026-07-30T00:00:00.000Z") }, today)).toBe(OceanRateStatus.INACTIVE);
  });

  it("labels missing validity as needing validity", () => {
    expect(getComputedOceanRateStatus({ status: OceanRateStatus.ACTIVE, validityStartDate: null, validityEndDate: null }, today)).toBe("NEEDS_VALIDITY");
  });
});

describe("ocean freight pricing email ingestion", () => {
  const ctx = { tenantId: "tenant-a", userId: "user-a", role: PlatformRole.MANAGER };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    prismaMock.tenantModuleAccess.findFirst.mockResolvedValue({ id: "access" });
    prismaMock.tenantRoleModuleAccess.findMany.mockResolvedValue([]);
    prismaMock.tenantRolePolicy.findUnique.mockResolvedValue(null);
    prismaMock.oceanFreightSourceEmail.upsert.mockImplementation(async ({ create }) => ({ id: `source-${create.graphMessageId}`, ...create }));
    prismaMock.auditLog.create.mockResolvedValue({});
  });

  it("detects likely ocean freight rate emails deterministically", () => {
    const result = detectOceanFreightRateEmail({ subject: "July FCL ocean rate sheet", bodyText: "40HQ validity valid until August. POL Shanghai POD LA." });
    expect(result.rateDetected).toBe(true);
    expect(result.detectionReason).toContain("rate sheet");
  });

  it("keeps non-rate emails with a negative detection reason", () => {
    const result = detectOceanFreightRateEmail({ subject: "Team lunch", bodyText: "Please confirm attendance." });
    expect(result.rateDetected).toBe(false);
    expect(result.detectionReason).toBe("No ocean freight pricing terms matched.");
  });

  it("upserts tenant-scoped source emails and does not duplicate duplicate graph messages", async () => {
    prismaMock.oceanFreightSourceEmail.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "existing" });
    const message = { id: "graph-1", mailboxAddress: "Pricing@Example.com", subject: "Ocean rate", receivedDateTime: "2026-07-07T00:00:00Z", body: { content: "FCL 40HQ valid until August" } };
    const result = await persistOceanFreightSourceEmails({ tenantId: "tenant-a", actorUserId: "user-a", jobRunId: "job-1", mailboxes: ["pricing@example.com"], messages: [message, message] });

    expect(result).toMatchObject({ messageCount: 2, storedCount: 2, createdCount: 1, updatedCount: 1, detectedRateEmailCount: 2 });
    expect(prismaMock.oceanFreightSourceEmail.upsert).toHaveBeenCalledTimes(2);
    expect(prismaMock.oceanFreightSourceEmail.upsert.mock.calls[0][0].where.tenantId_mailboxAddress_graphMessageId).toEqual({ tenantId: "tenant-a", mailboxAddress: "pricing@example.com", graphMessageId: "graph-1" });
  });

  it("creates an ingestion job with the ocean email ingestion job type", async () => {
    prismaMock.automationJobRun.create.mockResolvedValue({ id: "job-1", status: JobStatus.QUEUED });
    await expect(triggerOceanFreightEmailIngestion(ctx)).rejects.toThrow();
    expect(prismaMock.automationJobRun.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ tenantId: "tenant-a", jobType: OCEAN_FREIGHT_EMAIL_INGESTION_JOB_TYPE, status: JobStatus.QUEUED }) }));
  });

  it("requires module access for source and job queries", async () => {
    prismaMock.oceanFreightSourceEmail.findMany.mockResolvedValue([]);
    prismaMock.automationJobRun.findMany.mockResolvedValue([]);
    await getOceanFreightSourcesShell(ctx, { detectedOnly: "true" });
    await getOceanFreightJobsShell(ctx);
    expect(prismaMock.oceanFreightSourceEmail.findMany.mock.calls[0][0].where).toMatchObject({ tenantId: "tenant-a", rateDetected: true });
    expect(prismaMock.automationJobRun.findMany.mock.calls[0][0].where).toMatchObject({ tenantId: "tenant-a", jobType: OCEAN_FREIGHT_EMAIL_INGESTION_JOB_TYPE });
  });

  it("blocks READ_ONLY from triggering ingestion", async () => {
    await expect(triggerOceanFreightEmailIngestion({ ...ctx, role: PlatformRole.READ_ONLY })).rejects.toThrow(/Read-only/);
    expect(prismaMock.automationJobRun.create).not.toHaveBeenCalled();
  });

  it("requires tenant module entitlement before ocean module access", async () => {
    prismaMock.tenantModuleAccess.findFirst.mockResolvedValue(null);
    await expect(requireModule(ctx, ModuleKey.OCEAN_FREIGHT_PRICING)).rejects.toThrow(/not enabled/);
  });

  it("resolves shared mailbox aliases when direct Graph mailbox lookup returns ErrorInvalidUser", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { code: "ErrorInvalidUser", message: "The requested user is invalid." } }), { status: 404 })
      )
      .mockResolvedValueOnce(
        Response.json({ value: [{ id: "resolved-user-id", mail: "pricing-alias@example.com", userPrincipalName: "pricing@example.com" }] })
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(resolveMicrosoftGraphMailboxMessagesPath("token", "pricing-alias@example.com")).resolves.toBe("users/resolved-user-id/messages");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1][0])).toContain("mail%20eq%20'pricing-alias%40example.com'");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });
});
