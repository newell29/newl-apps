import { beforeEach, describe, expect, it, vi } from "vitest";
import { JobStatus, SequenceStatus, type Prisma } from "@prisma/client";

const prismaMock = vi.hoisted(() => ({
  automationJobRun: {
    findFirst: vi.fn(),
    update: vi.fn()
  },
  auditLog: {
    create: vi.fn()
  }
}));

vi.mock("@/server/db", () => ({ prisma: prismaMock }));

import {
  APOLLO_PROPAGATION_PENDING_REASON,
  isApolloSequenceMembershipConfirmed,
  parseApolloPushJobOutput,
  persistApolloPushJobPendingResolution,
  readApolloPendingSequenceConfirmation
} from "@/modules/lead-gen/apollo-push-jobs";

describe("Apollo enrollment confirmation jobs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.automationJobRun.update.mockResolvedValue({});
    prismaMock.auditLog.create.mockResolvedValue({});
  });

  it("upgrades legacy propagation skips to an explicit pending state", () => {
    const output = parseApolloPushJobOutput({
      selectedContacts: 1,
      processedContacts: 1,
      enrolledContacts: 0,
      skippedContacts: 1,
      failedContacts: 0,
      companiesTouched: 1,
      details: [
        {
          contactId: "contact-1",
          contactName: "Cynthia Sykes",
          companyName: "HYOSUNG USA, INC.",
          outcome: "skipped",
          reason: APOLLO_PROPAGATION_PENDING_REASON
        }
      ]
    } as Prisma.JsonValue);

    expect(output).toMatchObject({
      pendingContacts: 1,
      skippedContacts: 0,
      failedContacts: 0
    });
    expect(output?.details[0]?.outcome).toBe("pending");
  });

  it("reads tenant-safe pending metadata with backward-compatible defaults", () => {
    expect(
      readApolloPendingSequenceConfirmation(
        {
          apollo: {
            pendingSequenceConfirmation: {
              sequenceId: "sequence-1",
              sequenceName: "Hunter - Email Only",
              jobRunId: "job-1",
              acceptedAt: "2026-07-29T10:45:00.000Z"
            }
          }
        } as Prisma.JsonValue,
        "job-1"
      )
    ).toEqual({
      sequenceId: "sequence-1",
      sequenceName: "Hunter - Email Only",
      jobRunId: "job-1",
      acceptedAt: "2026-07-29T10:45:00.000Z",
      attemptCount: 0,
      lastCheckedAt: null,
      nextCheckAt: null
    });
  });

  it("does not treat stale finished history as a newly confirmed enrollment", () => {
    expect(isApolloSequenceMembershipConfirmed(SequenceStatus.READY)).toBe(true);
    expect(isApolloSequenceMembershipConfirmed(SequenceStatus.ENROLLED)).toBe(true);
    expect(isApolloSequenceMembershipConfirmed(SequenceStatus.PAUSED)).toBe(true);
    expect(isApolloSequenceMembershipConfirmed(SequenceStatus.FINISHED)).toBe(false);
    expect(isApolloSequenceMembershipConfirmed(SequenceStatus.NOT_STARTED)).toBe(false);
  });

  it("moves a pending job to enrolled only through the matching tenant job", async () => {
    prismaMock.automationJobRun.findFirst.mockResolvedValue({
      id: "job-1",
      output: {
        selectedContacts: 1,
        processedContacts: 1,
        enrolledContacts: 0,
        pendingContacts: 1,
        skippedContacts: 0,
        failedContacts: 0,
        companiesTouched: 1,
        details: [
          {
            contactId: "contact-1",
            contactName: "Cynthia Sykes",
            companyName: "HYOSUNG USA, INC.",
            outcome: "pending",
            reason: APOLLO_PROPAGATION_PENDING_REASON
          }
        ]
      }
    });

    await expect(
      persistApolloPushJobPendingResolution({
        tenantId: "tenant-a",
        jobRunId: "job-1",
        contactId: "contact-1",
        outcome: "enrolled",
        reason: 'Enrollment confirmed in "Hunter - Email Only".'
      })
    ).resolves.toBe(true);

    expect(prismaMock.automationJobRun.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "job-1",
          tenantId: "tenant-a"
        })
      })
    );
    expect(prismaMock.automationJobRun.update).toHaveBeenCalledWith({
      where: { id: "job-1" },
      data: expect.objectContaining({
        status: JobStatus.SUCCESS,
        errorMessage: null,
        output: expect.objectContaining({
          enrolledContacts: 1,
          pendingContacts: 0,
          skippedContacts: 0,
          failedContacts: 0
        })
      })
    });
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: "tenant-a",
        action: "lead-gen.apollo-push.pending-confirmed",
        entityType: "Contact",
        entityId: "contact-1"
      })
    });
  });
});
