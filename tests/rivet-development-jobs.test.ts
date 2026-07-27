import { JobStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  automationJobRun: {
    create: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    updateMany: vi.fn(),
    update: vi.fn()
  },
  developmentSuggestion: {
    updateMany: vi.fn()
  },
  codexReviewRun: {
    create: vi.fn()
  },
  auditLog: {
    create: vi.fn()
  },
  $transaction: vi.fn()
}));

vi.mock("@/server/db", () => ({ prisma: prismaMock }));

import {
  claimRivetDevelopmentJob,
  createRivetDevelopmentJob,
  RIVET_DEVELOPMENT_JOB_TYPE,
  updateRivetDevelopmentJob
} from "@/modules/assistant/rivet-development-jobs";
import type { AuthenticatedContext } from "@/server/tenant-context";

const context: AuthenticatedContext = {
  tenantId: "tenant-1",
  tenantSlug: "newl",
  tenantName: "Newl",
  userId: "admin-1",
  userEmail: "admin@example.com",
  userName: "Admin",
  role: "ADMIN"
};

const storedInput = {
  version: 1,
  suggestionId: "suggestion-1",
  approvedByUserId: "admin-1",
  moduleKey: "SHIPMENT_DOCUMENTS",
  workflowKey: "GARLAND_TEAMSHIP_REVIEW",
  issueKey: "GARLAND_SPECIAL_INSTRUCTIONS",
  title: "Garland Special Instructions extraction",
  summary: "CHEMTREC was omitted.",
  rationale: "One confirmed report.",
  riskLevel: "HIGH",
  repository: "newell29/newl-apps",
  baseBranch: "main",
  model: "gpt-5.6-sol",
  reasoningEffort: "high",
  requiredContextPaths: [
    "AGENTS.md",
    "docs/customers/garland/overview.md",
    "docs/customers/garland/parsing-rules.md"
  ],
  sourceFeedback: [
    {
      id: "feedback-1",
      classification: "CHECK_RESULT",
      subjectType: "GARLAND_CHECK",
      subjectId: "PS210491",
      reporterStatement: "Special Instructions omitted CHEMTREC.",
      expectedOutcome: "PASS",
      observedOutcome: "FAIL"
    }
  ],
  allowedActions: ["EDIT_ISOLATED_BRANCH", "OPEN_PULL_REQUEST"],
  forbiddenActions: ["MERGE", "DEPLOY", "TEAMSHIP_WRITE", "PRINT"]
};

describe("Rivet approved development jobs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.$transaction.mockImplementation(async (callback) => callback(prismaMock));
    prismaMock.codexReviewRun.create.mockResolvedValue({ id: "review-1" });
  });

  it("queues a tenant-scoped local Codex packet with required Garland context and hard safety boundaries", async () => {
    prismaMock.automationJobRun.create.mockResolvedValue({
      id: "job-1",
      status: JobStatus.QUEUED,
      input: storedInput,
      output: { phase: "QUEUED", attempt: 0 },
      errorMessage: null
    });

    await createRivetDevelopmentJob(
      prismaMock as never,
      context,
      {
        id: "suggestion-1",
        moduleKey: "SHIPMENT_DOCUMENTS",
        workflowKey: "GARLAND_TEAMSHIP_REVIEW",
        title: "Garland Special Instructions extraction",
        summary: "CHEMTREC was omitted.",
        rationale: "One confirmed report.",
        riskLevel: "HIGH",
        sourceFeedbackIds: ["feedback-1"],
        proposedScope: { issueKey: "GARLAND_SPECIAL_INSTRUCTIONS" }
      },
      [{
        id: "feedback-1",
        moduleKey: "SHIPMENT_DOCUMENTS",
        workflowKey: "GARLAND_TEAMSHIP_REVIEW",
        classification: "CHECK_RESULT",
        subjectType: "GARLAND_CHECK",
        subjectId: "PS210491",
        reporterStatement: "Special Instructions omitted CHEMTREC.",
        expectedOutcome: "PASS",
        observedOutcome: "FAIL"
      }]
    );

    expect(prismaMock.automationJobRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: "tenant-1",
        jobType: RIVET_DEVELOPMENT_JOB_TYPE,
        status: JobStatus.QUEUED,
        input: expect.objectContaining({
          issueKey: "GARLAND_SPECIAL_INSTRUCTIONS",
          requiredContextPaths: expect.arrayContaining([
            "AGENTS.md",
            "docs/customers/garland/overview.md",
            "docs/customers/garland/parsing-rules.md"
          ]),
          forbiddenActions: expect.arrayContaining([
            "MERGE",
            "DEPLOY",
            "DATABASE_MIGRATION_EXECUTION",
            "TEAMSHIP_WRITE",
            "PRINT"
          ])
        })
      })
    });
  });

  it("atomically claims at most one queued job and returns a short-lived lease", async () => {
    prismaMock.automationJobRun.findFirst.mockResolvedValue({
      id: "job-1",
      tenantId: "tenant-1",
      jobType: RIVET_DEVELOPMENT_JOB_TYPE,
      status: JobStatus.QUEUED,
      input: storedInput,
      output: { phase: "QUEUED", attempt: 0 }
    });
    prismaMock.automationJobRun.updateMany.mockResolvedValue({ count: 1 });

    const result = await claimRivetDevelopmentJob(context);

    expect(result.state).toBe("claimed");
    if (result.state !== "claimed") throw new Error("Expected a claimed job.");
    expect(result.packet.issueKey).toBe("GARLAND_SPECIAL_INSTRUCTIONS");
    expect(result.packet.branchName).toMatch(/^codex\/rivet-/);
    expect(result.leaseToken.length).toBeGreaterThan(20);
    expect(prismaMock.automationJobRun.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: "tenant-1",
          status: JobStatus.QUEUED
        }),
        data: expect.objectContaining({
          status: JobStatus.RUNNING,
          output: expect.objectContaining({
            phase: "CLAIMED",
            leaseTokenHash: expect.any(String)
          })
        })
      })
    );
  });

  it("fails an expired lease for explicit review instead of starting a duplicate worker", async () => {
    prismaMock.automationJobRun.findFirst.mockResolvedValue(null);
    prismaMock.automationJobRun.findMany.mockResolvedValue([{
      id: "job-expired",
      output: {
        phase: "RUNNING",
        leaseExpiresAt: "2026-01-01T00:00:00.000Z"
      }
    }]);

    const result = await claimRivetDevelopmentJob(context);

    expect(result).toEqual({ state: "expired", jobId: "job-expired" });
    expect(prismaMock.automationJobRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "job-expired" },
        data: expect.objectContaining({
          status: JobStatus.ERROR,
          output: expect.objectContaining({
            phase: "FAILED",
            errorCode: "LEASE_EXPIRED"
          })
        })
      })
    );
  });

  it("records only an approved-repository PR and never merges or deploys", async () => {
    prismaMock.automationJobRun.findFirst.mockResolvedValueOnce({
      id: "job-1",
      tenantId: "tenant-1",
      jobType: RIVET_DEVELOPMENT_JOB_TYPE,
      status: JobStatus.QUEUED,
      input: storedInput,
      output: { phase: "QUEUED", attempt: 0 }
    });
    prismaMock.automationJobRun.updateMany.mockResolvedValue({ count: 1 });
    const claim = await claimRivetDevelopmentJob(context);
    if (claim.state !== "claimed") throw new Error("Expected a claimed job.");

    const claimedOutput = prismaMock.automationJobRun.updateMany.mock.calls[0][0].data.output;
    prismaMock.automationJobRun.findFirst.mockResolvedValue({
      id: "job-1",
      tenantId: "tenant-1",
      jobType: RIVET_DEVELOPMENT_JOB_TYPE,
      status: JobStatus.RUNNING,
      input: storedInput,
      output: claimedOutput
    });

    const review = await updateRivetDevelopmentJob(context, {
      action: "review",
      jobId: "job-1",
      leaseToken: claim.leaseToken,
      commitSha: "a".repeat(40),
      reviewAttempt: 1,
      reviewStartedAt: new Date().toISOString(),
      reviewVerdict: "PASS",
      reviewRiskLevel: "LOW",
      reviewSummary: "The exact commit passed the independent review.",
      reviewFindings: [],
      ticketCoverage: {
        implemented: ["Preserved wrapped Special Instructions."],
        missing: [],
        outOfScope: []
      },
      reviewChecks: {
        privacy: { status: "PASS", note: "Synthetic fixtures only." }
      },
      reviewTests: {
        required: ["Focused Garland tests"],
        passed: ["Focused Garland tests"],
        knownFailures: []
      },
      businessQuestions: []
    });

    expect(review).toMatchObject({
      state: "reviewed",
      verdict: "PASS",
      findingCount: 0
    });
    expect(prismaMock.codexReviewRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: "tenant-1",
        developmentSuggestionId: "suggestion-1",
        developmentJobId: "job-1",
        commitSha: "a".repeat(40),
        attempt: 1,
        verdict: "PASS"
      })
    });

    const reviewedOutput = prismaMock.automationJobRun.update.mock.calls.at(-1)?.[0]?.data?.output;
    prismaMock.automationJobRun.findFirst.mockResolvedValue({
      id: "job-1",
      tenantId: "tenant-1",
      jobType: RIVET_DEVELOPMENT_JOB_TYPE,
      status: JobStatus.RUNNING,
      input: storedInput,
      output: reviewedOutput
    });

    await expect(updateRivetDevelopmentJob(context, {
      action: "review",
      jobId: "job-1",
      leaseToken: claim.leaseToken,
      commitSha: "a".repeat(40),
      reviewAttempt: 1,
      reviewVerdict: "PASS",
      reviewRiskLevel: "LOW",
      reviewSummary: "Duplicate review.",
      reviewFindings: [],
      ticketCoverage: { implemented: [], missing: [], outOfScope: [] },
      reviewChecks: {},
      reviewTests: {},
      businessQuestions: []
    })).rejects.toThrow("out of sequence");

    const result = await updateRivetDevelopmentJob(context, {
      action: "complete",
      jobId: "job-1",
      leaseToken: claim.leaseToken,
      branchName: claim.packet.branchName,
      commitSha: "a".repeat(40),
      pullRequestUrls: ["https://github.com/newell29/newl-apps/pull/999"],
      summary: "Preserved wrapped Special Instructions.",
      tests: ["35 Garland tests passed."],
      knownLimitations: []
    });

    expect(result.state).toBe("completed");
    expect(prismaMock.developmentSuggestion.updateMany).toHaveBeenCalledWith({
      where: {
        tenantId: "tenant-1",
        id: "suggestion-1",
        developmentThreadId: "job-1"
      },
      data: { pullRequestUrl: "https://github.com/newell29/newl-apps/pull/999" }
    });
    expect(result.teamsMessage).toContain("READY_FOR_ALEX");
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "assistant.rivet_development.completed",
          after: expect.not.objectContaining({
            merged: true,
            deployed: true
          })
        })
      })
    );
  });

  it("refuses to mark a PR ready when the exact commit has not passed independent review", async () => {
    prismaMock.automationJobRun.findFirst.mockResolvedValueOnce({
      id: "job-1",
      tenantId: "tenant-1",
      jobType: RIVET_DEVELOPMENT_JOB_TYPE,
      status: JobStatus.QUEUED,
      input: storedInput,
      output: { phase: "QUEUED", attempt: 0 }
    });
    prismaMock.automationJobRun.updateMany.mockResolvedValue({ count: 1 });
    const claim = await claimRivetDevelopmentJob(context);
    if (claim.state !== "claimed") throw new Error("Expected a claimed job.");
    const claimedOutput = prismaMock.automationJobRun.updateMany.mock.calls[0][0].data.output;
    prismaMock.automationJobRun.findFirst.mockResolvedValue({
      id: "job-1",
      tenantId: "tenant-1",
      jobType: RIVET_DEVELOPMENT_JOB_TYPE,
      status: JobStatus.RUNNING,
      input: storedInput,
      output: claimedOutput
    });

    await expect(updateRivetDevelopmentJob(context, {
      action: "complete",
      jobId: "job-1",
      leaseToken: claim.leaseToken,
      branchName: claim.packet.branchName,
      commitSha: "b".repeat(40),
      pullRequestUrls: ["https://github.com/newell29/newl-apps/pull/999"],
      summary: "Unreviewed change.",
      tests: [],
      knownLimitations: []
    })).rejects.toThrow("independent Codex review passes the exact commit");
  });

  it("stores blocked review evidence and preserves the draft PR for Alex", async () => {
    prismaMock.automationJobRun.findFirst.mockResolvedValueOnce({
      id: "job-1",
      tenantId: "tenant-1",
      jobType: RIVET_DEVELOPMENT_JOB_TYPE,
      status: JobStatus.QUEUED,
      input: storedInput,
      output: { phase: "QUEUED", attempt: 0 }
    });
    prismaMock.automationJobRun.updateMany.mockResolvedValue({ count: 1 });
    const claim = await claimRivetDevelopmentJob(context);
    if (claim.state !== "claimed") throw new Error("Expected a claimed job.");
    const claimedOutput = prismaMock.automationJobRun.updateMany.mock.calls[0][0].data.output;
    prismaMock.automationJobRun.findFirst.mockResolvedValue({
      id: "job-1",
      tenantId: "tenant-1",
      jobType: RIVET_DEVELOPMENT_JOB_TYPE,
      status: JobStatus.RUNNING,
      input: storedInput,
      output: claimedOutput
    });

    await updateRivetDevelopmentJob(context, {
      action: "review",
      jobId: "job-1",
      leaseToken: claim.leaseToken,
      commitSha: "c".repeat(40),
      reviewAttempt: 1,
      reviewVerdict: "BLOCKED",
      reviewRiskLevel: "HIGH",
      reviewSummary: "The change requires a new business decision.",
      reviewFindings: [{
        severity: "HIGH",
        category: "BUSINESS_SCOPE",
        file: "src/example.ts",
        line: 10,
        summary: "The change broadens the approved rule.",
        requiredFix: "Ask the owner to approve the broader behaviour.",
        autoFixable: false,
        businessDecisionRequired: true
      }],
      ticketCoverage: { implemented: [], missing: ["Approved rule"], outOfScope: ["New rule"] },
      reviewChecks: {},
      reviewTests: { required: [], passed: [], knownFailures: [] },
      businessQuestions: ["Should the broader rule be approved?"]
    });
    const blockedOutput = prismaMock.automationJobRun.update.mock.calls.at(-1)?.[0]?.data?.output;
    prismaMock.automationJobRun.findFirst.mockResolvedValue({
      id: "job-1",
      tenantId: "tenant-1",
      jobType: RIVET_DEVELOPMENT_JOB_TYPE,
      status: JobStatus.RUNNING,
      input: storedInput,
      output: blockedOutput
    });

    const result = await updateRivetDevelopmentJob(context, {
      action: "fail",
      jobId: "job-1",
      leaseToken: claim.leaseToken,
      branchName: claim.packet.branchName,
      commitSha: "c".repeat(40),
      pullRequestUrls: ["https://github.com/newell29/newl-apps/pull/999"],
      errorCode: "RIVET_REVIEW_BLOCKED",
      errorMessage: "Independent review needs an owner decision."
    });

    expect(result).toMatchObject({
      state: "blocked",
      pullRequestUrls: ["https://github.com/newell29/newl-apps/pull/999"]
    });
    expect(prismaMock.developmentSuggestion.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { pullRequestUrl: "https://github.com/newell29/newl-apps/pull/999" }
      })
    );
  });
});
