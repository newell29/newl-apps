import { ContactStatus, JobStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { buildApprovedOutreachEnrollment } from "@/modules/lead-gen/outreach-enrollment";

describe("approved outreach enrollment", () => {
  it("turns one plan approval into a queued Apollo enrollment and assigns the approver by default", () => {
    const result = buildApprovedOutreachEnrollment({
      tenantId: "tenant-1",
      contactId: "contact-1",
      assignedRep: null,
      actorUserId: "user-alex",
      requestedAt: new Date("2026-07-27T18:00:00.000Z")
    });

    expect(result.contactUpdate).toEqual({
      contactStatus: ContactStatus.APPROVED,
      assignedRep: "user-alex"
    });
    expect(result.job).toMatchObject({
      tenantId: "tenant-1",
      jobType: "lead-gen.apollo-push",
      status: JobStatus.QUEUED,
      input: {
        contactIds: ["contact-1"],
        selectedContacts: 1,
        requestedAt: "2026-07-27T18:00:00.000Z"
      },
      output: {
        selectedContacts: 1,
        companiesTouched: 1
      }
    });
  });

  it("preserves an existing sender assignment", () => {
    const result = buildApprovedOutreachEnrollment({
      tenantId: "tenant-1",
      contactId: "contact-1",
      assignedRep: "user-faisal",
      actorUserId: "user-alex",
      requestedAt: new Date("2026-07-27T18:00:00.000Z")
    });

    expect(result.contactUpdate.assignedRep).toBe("user-faisal");
  });
});
