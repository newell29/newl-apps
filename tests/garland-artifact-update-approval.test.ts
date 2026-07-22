import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  workflowArtifact: { findFirst: vi.fn(), update: vi.fn() },
  auditLog: { create: vi.fn() }
}));
const approveJobMock = vi.hoisted(() => vi.fn());

vi.mock("@/server/db", () => ({ prisma: prismaMock }));
vi.mock("@/modules/shipment-documents/teamship-update-jobs", () => ({
  createTeamshipUpdateJob: vi.fn(),
  approveTeamshipUpdateJob: approveJobMock
}));

import { approveGarlandArtifactUpdate } from "@/modules/assistant/garland-artifacts";
import type { AuthenticatedContext } from "@/server/tenant-context";

const context: AuthenticatedContext = {
  tenantId: "tenant-1",
  tenantSlug: "newl",
  tenantName: "Newl",
  userId: "user-1",
  userEmail: "employee@newl.ca",
  userName: "Employee",
  role: "OPERATIONS"
};

describe("Garland artifact Teamship update approval", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.workflowArtifact.findFirst.mockResolvedValue({
      id: "artifact-1",
      extractionSummary: {
        targetReference: "PS210235",
        updateProposal: {
          jobId: "job-1",
          approvalRequired: true
        }
      }
    });
    approveJobMock.mockResolvedValue({ id: "job-1", status: "APPROVED" });
  });

  it("approves only the exact job and selected order bound to the saved artifact", async () => {
    await expect(approveGarlandArtifactUpdate(context, "artifact-1", {
      jobId: "job-1",
      targetReference: "PS210235",
      confirmation: "APPROVE_TEAMSHIP_UPDATE"
    })).resolves.toMatchObject({
      jobId: "job-1",
      status: "APPROVED",
      queuedForTeamshipWorker: true,
      printingRequested: false
    });
    expect(approveJobMock).toHaveBeenCalledWith(context, "job-1");
    expect(prismaMock.workflowArtifact.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        extractionSummary: expect.objectContaining({
          updateProposal: expect.objectContaining({
            status: "APPROVED",
            approvalRequired: false
          })
        })
      })
    }));
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        tenantId: "tenant-1",
        actorUserId: "user-1",
        action: "assistant.garland_artifact.update_approved"
      })
    }));
  });

  it("rejects a mismatched job before approving anything", async () => {
    await expect(approveGarlandArtifactUpdate(context, "artifact-1", {
      jobId: "job-other",
      targetReference: "PS210235",
      confirmation: "APPROVE_TEAMSHIP_UPDATE"
    })).rejects.toThrow("does not match");
    expect(approveJobMock).not.toHaveBeenCalled();
  });
});
