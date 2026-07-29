import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApolloStatus, JobStatus, ReplyStatus, SequenceStatus } from "@prisma/client";

const prismaMock = vi.hoisted(() => ({
  automationJobRun: {
    updateMany: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    findMany: vi.fn()
  },
  contact: {
    findMany: vi.fn(),
    updateMany: vi.fn(),
    count: vi.fn(),
    findFirst: vi.fn()
  },
  lead: { findFirst: vi.fn() },
  auditLog: { create: vi.fn() },
  tenant: { findMany: vi.fn() },
  integrationCredential: { findFirst: vi.fn() }
}));

vi.mock("@/server/db", () => ({ prisma: prismaMock }));

import { syncApolloStatusesForTenant } from "@/modules/lead-gen/apollo-status-sync";
import { ApolloRateLimitError, type ApolloContactRecord } from "@/server/integrations/apollo";

const tenant = { tenantId: "tenant-a", tenantSlug: "newl", tenantName: "Newl" };
const now = new Date("2026-07-22T18:00:00.000Z");

function existingContact(id = "contact-1") {
  return {
    id,
    companyId: "company-1",
    apolloContactId: `apollo-${id}`,
    apolloPersonId: null,
    sequenceStatus: SequenceStatus.ENROLLED,
    replyStatus: ReplyStatus.NO_REPLY,
    selectedSequenceId: "sequence-1",
    selectedSequenceName: "Charlotte Warehousing",
    lastTouchAt: null,
    lastReplyAt: null,
    rawJson: null,
    apolloSyncFailureCount: 0
  };
}

function incomingContact(): ApolloContactRecord {
  return {
    recordSource: "SAVED_CONTACT",
    apolloContactId: "apollo-contact-1",
    apolloPersonId: "person-1",
    firstName: "Jordan",
    lastName: "Demo",
    lastNameObfuscated: null,
    fullName: "Jordan Demo",
    title: "Director of Supply Chain",
    department: "Operations",
    seniority: "director",
    email: "jordan@example.com",
    phone: null,
    linkedinUrl: null,
    hasEmailAvailable: true,
    hasPhoneAvailable: false,
    hasLinkedinAvailable: false,
    city: null,
    state: null,
    country: null,
    sequenceStatus: SequenceStatus.REPLIED,
    replyStatus: ReplyStatus.POSITIVE,
    sequenceId: "sequence-1",
    sequenceName: "Charlotte Warehousing",
    sequenceOwnerName: null,
    sequenceOwnerUserId: null,
    lastTouchAt: now,
    lastReplyAt: now,
    rawPayload: { id: "apollo-contact-1", reply_status: "positive" }
  };
}

describe("scheduled Apollo status sync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.automationJobRun.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.automationJobRun.findFirst.mockResolvedValue(null);
    prismaMock.automationJobRun.create.mockResolvedValue({ id: "job-1" });
    prismaMock.automationJobRun.update.mockResolvedValue({});
    prismaMock.contact.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.lead.findFirst.mockResolvedValue({ id: "lead-1" });
    prismaMock.auditLog.create.mockResolvedValue({});
  });

  it("updates a due contact and links reply outcomes to the pre-outcome score", async () => {
    prismaMock.contact.findMany.mockResolvedValue([existingContact()]);
    const fetchContact = vi.fn().mockResolvedValue(incomingContact());
    const recordScoreSnapshot = vi.fn().mockResolvedValue({ id: "snapshot-1" });
    const recordOutcome = vi.fn().mockResolvedValue({ id: "outcome-1" });

    const result = await syncApolloStatusesForTenant(tenant, {
      dependencies: {
        fetchContact,
        now: () => now,
        sleep: vi.fn(),
        recordScoreSnapshot,
        recordOutcome
      }
    });

    expect(prismaMock.contact.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ tenantId: "tenant-a" }) })
    );
    expect(prismaMock.contact.updateMany).toHaveBeenCalledWith({
      where: { id: "contact-1", tenantId: "tenant-a" },
      data: expect.objectContaining({
        apolloStatus: ApolloStatus.ENRICHED,
        sequenceStatus: SequenceStatus.REPLIED,
        replyStatus: ReplyStatus.POSITIVE,
        apolloLastSyncedAt: now,
        apolloSyncFailureCount: 0,
        apolloSyncLastError: null
      })
    });
    expect(recordScoreSnapshot).toHaveBeenCalledWith({
      tenantId: "tenant-a",
      contactId: "contact-1",
      trigger: "APOLLO_STATUS_SYNC"
    });
    expect(recordScoreSnapshot.mock.invocationCallOrder[0]).toBeLessThan(
      prismaMock.contact.updateMany.mock.invocationCallOrder[0]
    );
    expect(recordOutcome).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-a",
        contactId: "contact-1",
        outcomeType: "APOLLO_REPLY_STATUS_CHANGED",
        scoreSnapshotId: "snapshot-1"
      })
    );
    expect(result).toMatchObject({ status: "success", syncedContacts: 1, changedContacts: 1, failedContacts: 0 });
    expect(prismaMock.automationJobRun.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: JobStatus.SUCCESS }) })
    );
  });

  it("uses bounded retries and defers the remaining batch after sustained rate limiting", async () => {
    prismaMock.contact.findMany.mockResolvedValue([existingContact(), existingContact("contact-2")]);
    const fetchContact = vi.fn().mockRejectedValue(new ApolloRateLimitError("Too many requests", 10));
    const sleep = vi.fn().mockResolvedValue(undefined);

    const result = await syncApolloStatusesForTenant(tenant, {
      dependencies: {
        fetchContact,
        now: () => now,
        sleep,
        recordScoreSnapshot: vi.fn(),
        recordOutcome: vi.fn()
      }
    });

    expect(fetchContact).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      status: "error",
      syncedContacts: 0,
      failedContacts: 1,
      deferredContacts: 1,
      retryCount: 2,
      rateLimited: true
    });
    expect(prismaMock.contact.updateMany).toHaveBeenCalledWith({
      where: { id: "contact-1", tenantId: "tenant-a" },
      data: expect.objectContaining({
        apolloSyncFailureCount: 1,
        apolloSyncLastError: "Too many requests"
      })
    });
    expect(prismaMock.automationJobRun.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: JobStatus.ERROR }) })
    );
  });

  it("replaces stale finished history when Apollo reports the selected Hunter cadence active", async () => {
    prismaMock.contact.findMany.mockResolvedValue([{
      ...existingContact(),
      sequenceStatus: SequenceStatus.FINISHED,
      selectedSequenceId: "hunter-sequence",
      selectedSequenceName: "Hunter - Email Only"
    }]);
    const fetchContact = vi.fn().mockResolvedValue({
      ...incomingContact(),
      sequenceStatus: SequenceStatus.ENROLLED,
      replyStatus: ReplyStatus.NO_REPLY,
      sequenceId: "hunter-sequence",
      sequenceName: "Hunter - Email Only",
      lastReplyAt: null
    });

    await syncApolloStatusesForTenant(tenant, {
      dependencies: {
        fetchContact,
        now: () => now,
        sleep: vi.fn(),
        recordScoreSnapshot: vi.fn().mockResolvedValue({ id: "snapshot-1" }),
        recordOutcome: vi.fn().mockResolvedValue({ id: "outcome-1" })
      }
    });

    expect(prismaMock.contact.updateMany).toHaveBeenCalledWith({
      where: { id: "contact-1", tenantId: "tenant-a" },
      data: expect.objectContaining({
        sequenceStatus: SequenceStatus.ENROLLED,
        selectedSequenceId: "hunter-sequence",
        selectedSequenceName: "Hunter - Email Only"
      })
    });
  });

  it("persists a bounced Apollo contact as terminal outreach state", async () => {
    prismaMock.contact.findMany.mockResolvedValue([
      {
        ...existingContact(),
        sequenceStatus: SequenceStatus.NOT_STARTED
      }
    ]);
    const fetchContact = vi.fn().mockResolvedValue({
      ...incomingContact(),
      sequenceStatus: SequenceStatus.BOUNCED,
      replyStatus: ReplyStatus.NO_REPLY,
      sequenceId: "sequence-1",
      sequenceName: "Charlotte Warehousing",
      lastReplyAt: null
    });

    await syncApolloStatusesForTenant(tenant, {
      dependencies: {
        fetchContact,
        now: () => now,
        sleep: vi.fn(),
        recordScoreSnapshot: vi.fn().mockResolvedValue({ id: "snapshot-1" }),
        recordOutcome: vi.fn().mockResolvedValue({ id: "outcome-1" })
      }
    });

    expect(prismaMock.contact.updateMany).toHaveBeenCalledWith({
      where: { id: "contact-1", tenantId: "tenant-a" },
      data: expect.objectContaining({
        sequenceStatus: SequenceStatus.BOUNCED
      })
    });
  });

  it("reconciles a durable pending enrollment when Apollo confirms the requested cadence", async () => {
    prismaMock.automationJobRun.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: "push-job-1",
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
              reason:
                "Apollo accepted the push, but the cadence enrollment is still propagating in Apollo and was not visible during Newl Apps verification."
            }
          ]
        }
      });
    prismaMock.contact.findMany.mockResolvedValue([
      {
        ...existingContact(),
        sequenceStatus: SequenceStatus.READY,
        selectedSequenceId: "hunter-email-sequence",
        selectedSequenceName: "Hunter - Email Only",
        rawJson: {
          apollo: {
            pendingSequenceConfirmation: {
              sequenceId: "hunter-email-sequence",
              sequenceName: "Hunter - Email Only",
              jobRunId: "push-job-1",
              acceptedAt: "2026-07-22T17:55:00.000Z"
            }
          }
        }
      }
    ]);
    const fetchContact = vi.fn().mockResolvedValue({
      ...incomingContact(),
      sequenceStatus: SequenceStatus.ENROLLED,
      replyStatus: ReplyStatus.NO_REPLY,
      sequenceId: "hunter-email-sequence",
      sequenceName: "Hunter - Email Only",
      lastReplyAt: null
    });

    const result = await syncApolloStatusesForTenant(tenant, {
      dependencies: {
        fetchContact,
        now: () => now,
        sleep: vi.fn(),
        recordScoreSnapshot: vi.fn().mockResolvedValue({ id: "snapshot-1" }),
        recordOutcome: vi.fn().mockResolvedValue({ id: "outcome-1" })
      }
    });

    expect(result).toMatchObject({
      status: "success",
      confirmedEnrollments: 1,
      failedEnrollments: 0
    });
    const contactUpdate = prismaMock.contact.updateMany.mock.calls[0]?.[0];
    expect(contactUpdate.data.rawJson.apollo.pendingSequenceConfirmation).toBeUndefined();
    expect(contactUpdate.data.rawJson.apollo.pushBlocker).toBeUndefined();
    expect(prismaMock.automationJobRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          output: expect.objectContaining({
            enrolledContacts: 1,
            pendingContacts: 0
          })
        })
      })
    );
  });

  it("clears a stale push blocker when the exact selected cadence is active without a pending marker", async () => {
    prismaMock.contact.findMany.mockResolvedValue([
      {
        ...existingContact(),
        sequenceStatus: SequenceStatus.READY,
        selectedSequenceId: "hunter-email-sequence",
        selectedSequenceName: "Hunter - Email Only",
        rawJson: {
          apollo: {
            pushBlocker: {
              reason: "Apollo enrollment confirmation metadata is missing.",
              blockedAt: "2026-07-22T17:55:00.000Z"
            }
          }
        }
      }
    ]);
    const fetchContact = vi.fn().mockResolvedValue({
      ...incomingContact(),
      sequenceStatus: SequenceStatus.ENROLLED,
      replyStatus: ReplyStatus.NO_REPLY,
      sequenceId: "hunter-email-sequence",
      sequenceName: "Hunter - Email Only",
      lastReplyAt: null
    });

    await syncApolloStatusesForTenant(tenant, {
      dependencies: {
        fetchContact,
        now: () => now,
        sleep: vi.fn(),
        recordScoreSnapshot: vi.fn().mockResolvedValue({ id: "snapshot-1" }),
        recordOutcome: vi.fn().mockResolvedValue({ id: "outcome-1" })
      }
    });

    const contactUpdate = prismaMock.contact.updateMany.mock.calls[0]?.[0];
    expect(contactUpdate.data.sequenceStatus).toBe(SequenceStatus.ENROLLED);
    expect(contactUpdate.data.rawJson.apollo.pushBlocker).toBeUndefined();
    expect(contactUpdate.data.rawJson.apollo.pendingSequenceConfirmation).toBeUndefined();
  });

  it("fails an expired pending enrollment instead of accepting stale finished history", async () => {
    prismaMock.automationJobRun.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: "push-job-1",
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
              reason:
                "Apollo accepted the push, but the cadence enrollment is still propagating in Apollo and was not visible during Newl Apps verification."
            }
          ]
        }
      });
    prismaMock.contact.findMany.mockResolvedValue([
      {
        ...existingContact(),
        sequenceStatus: SequenceStatus.READY,
        selectedSequenceId: "hunter-email-sequence",
        selectedSequenceName: "Hunter - Email Only",
        rawJson: {
          apollo: {
            pendingSequenceConfirmation: {
              sequenceId: "hunter-email-sequence",
              sequenceName: "Hunter - Email Only",
              jobRunId: "push-job-1",
              acceptedAt: "2026-07-22T17:45:00.000Z"
            }
          }
        }
      }
    ]);
    const fetchContact = vi.fn().mockResolvedValue({
      ...incomingContact(),
      sequenceStatus: SequenceStatus.FINISHED,
      replyStatus: ReplyStatus.NO_REPLY,
      sequenceId: "hunter-email-sequence",
      sequenceName: "Hunter - Email Only",
      lastReplyAt: null
    });

    const result = await syncApolloStatusesForTenant(tenant, {
      dependencies: {
        fetchContact,
        now: () => now,
        sleep: vi.fn(),
        recordScoreSnapshot: vi.fn().mockResolvedValue({ id: "snapshot-1" }),
        recordOutcome: vi.fn().mockResolvedValue({ id: "outcome-1" })
      }
    });

    expect(result).toMatchObject({
      status: "success",
      confirmedEnrollments: 0,
      failedEnrollments: 1
    });
    const contactUpdate = prismaMock.contact.updateMany.mock.calls[0]?.[0];
    expect(contactUpdate.data.rawJson.apollo.pendingSequenceConfirmation).toBeUndefined();
    expect(contactUpdate.data.rawJson.apollo.pushBlocker.reason).toContain(
      "still not present in the requested cadence after 10 minutes"
    );
    expect(prismaMock.automationJobRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: JobStatus.ERROR,
          output: expect.objectContaining({
            enrolledContacts: 0,
            pendingContacts: 0,
            failedContacts: 1
          })
        })
      })
    );
  });
});
