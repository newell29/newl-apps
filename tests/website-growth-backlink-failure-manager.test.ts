import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createRivetDevelopmentJob: vi.fn(),
  automationJobRun: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn()
  },
  operationalFeedback: {
    create: vi.fn()
  },
  developmentSuggestion: {
    create: vi.fn(),
    update: vi.fn()
  },
  auditLog: {
    create: vi.fn()
  },
  transaction: vi.fn()
}));

vi.mock("@/modules/assistant/rivet-development-jobs", () => ({
  createRivetDevelopmentJob: (...args: unknown[]) =>
    mocks.createRivetDevelopmentJob(...args)
}));
vi.mock("@/server/db", () => ({
  prisma: {
    automationJobRun: mocks.automationJobRun,
    operationalFeedback: mocks.operationalFeedback,
    developmentSuggestion: mocks.developmentSuggestion,
    auditLog: mocks.auditLog,
    $transaction: mocks.transaction
  }
}));

import {
  classifyWebsiteGrowthBacklinkFailure,
  recordWebsiteGrowthBacklinkFailure,
  WEBSITE_GROWTH_RIVET_APPROVAL_VALUE
} from "@/modules/website-growth/backlink-failure-manager";

describe("Website Growth backlink failure manager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transaction.mockImplementation(async (callback) =>
      callback({
        automationJobRun: mocks.automationJobRun,
        operationalFeedback: mocks.operationalFeedback,
        developmentSuggestion: mocks.developmentSuggestion,
        auditLog: mocks.auditLog
      })
    );
    mocks.automationJobRun.findFirst.mockResolvedValue(null);
    mocks.automationJobRun.findMany.mockResolvedValue([]);
    mocks.automationJobRun.create.mockResolvedValue({
      id: "incident-1"
    });
    mocks.operationalFeedback.create.mockResolvedValue({
      id: "feedback-1"
    });
    mocks.developmentSuggestion.create.mockResolvedValue({
      id: "suggestion-1",
      moduleKey: "WEBSITE_GROWTH",
      workflowKey: "WEBSITE_GROWTH_BACKLINK_OUTREACH",
      title: "Fix Website Growth backlink executor failure",
      summary: "SyntaxError",
      rationale: "Prepare a draft PR.",
      riskLevel: "MEDIUM",
      sourceFeedbackIds: ["feedback-1"],
      proposedScope: {}
    });
    mocks.createRivetDevelopmentJob.mockResolvedValue({
      id: "rivet-job-1"
    });
  });

  it("separates code defects from permission and uncertain-send failures", () => {
    expect(
      classifyWebsiteGrowthBacklinkFailure({
        error: "SyntaxError: Unexpected token",
        errorReason: null,
        summary: null,
        diagnostics: []
      })
    ).toBe("CODE_DEFECT");
    expect(
      classifyWebsiteGrowthBacklinkFailure({
        error: "Microsoft Graph sendMail returned an unknown response",
        errorReason: null,
        summary: null,
        diagnostics: []
      })
    ).toBe("AMBIGUOUS_EXTERNAL_ACTION");
    expect(
      classifyWebsiteGrowthBacklinkFailure({
        error: "Mailbox access policy denied permission",
        errorReason: "auth_permanent",
        summary: null,
        diagnostics: []
      })
    ).toBe("AUTHORIZATION_REQUIRED");
  });

  it("deduplicates an already recorded OpenClaw run", async () => {
    mocks.automationJobRun.findFirst.mockResolvedValue({
      id: "incident-existing",
      output: { developmentJobId: "rivet-existing" }
    });

    const result = await recordWebsiteGrowthBacklinkFailure({
      tenantId: "tenant-1",
      input: buildInput()
    });

    expect(result).toMatchObject({
      duplicate: true,
      notify: false,
      incidentId: "incident-existing",
      developmentJobId: "rivet-existing"
    });
    expect(mocks.automationJobRun.create).not.toHaveBeenCalled();
  });

  it("queues a restricted Rivet job for an owner-approved code defect", async () => {
    const result = await recordWebsiteGrowthBacklinkFailure({
      tenantId: "tenant-1",
      input: buildInput(),
      env: {
        WEBSITE_GROWTH_RIVET_AUTO_TRIAGE_APPROVAL:
          WEBSITE_GROWTH_RIVET_APPROVAL_VALUE
      },
      now: new Date("2026-07-25T16:00:00.000Z")
    });

    expect(mocks.operationalFeedback.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: "tenant-1",
        moduleKey: "WEBSITE_GROWTH",
        status: "CONFIRMED",
        reporterUserId: "system:website-growth-failure-manager"
      })
    });
    expect(mocks.developmentSuggestion.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        status: "APPROVED",
        proposedScope: expect.objectContaining({
          requiresHumanMerge: true,
          forbiddenAutomaticActions: expect.arrayContaining([
            "RETRY_OUTREACH",
            "MERGE",
            "DEPLOY",
            "PERMISSION_CHANGE"
          ])
        })
      })
    });
    expect(mocks.createRivetDevelopmentJob).toHaveBeenCalled();
    expect(result).toMatchObject({
      duplicate: false,
      developmentJobId: "rivet-job-1",
      notify: true,
      disableExecutor: false
    });
    expect(result.teamsMessage).toContain("Rivet queued");
  });

  it("trips the circuit breaker on the second identical failure", async () => {
    mocks.automationJobRun.findMany.mockResolvedValue([
      { output: { phase: "RECORDED" } }
    ]);

    const result = await recordWebsiteGrowthBacklinkFailure({
      tenantId: "tenant-1",
      input: {
        ...buildInput(),
        error: "Gateway closed while the browser target was loading"
      }
    });

    expect(result.disableExecutor).toBe(true);
    expect(result.developmentJobId).toBeNull();
    expect(result.teamsMessage).toContain("Circuit breaker");
  });

  it("redacts credentials before incident evidence is stored", async () => {
    await recordWebsiteGrowthBacklinkFailure({
      tenantId: "tenant-1",
      input: {
        ...buildInput(),
        error:
          "Authorization: Bearer secret-value access_token=unsafe-value"
      }
    });

    expect(mocks.automationJobRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        errorMessage: expect.stringContaining("[REDACTED]")
      })
    });
    expect(
      mocks.automationJobRun.create.mock.calls[0]?.[0]?.data.errorMessage
    ).not.toContain("secret-value");
  });
});

function buildInput() {
  return {
    sourceJobId: "outreach-job-1",
    sourceRunId: "outreach-run-1",
    status: "error" as const,
    error: "SyntaxError: Unexpected token in backlink executor",
    errorReason: "format",
    summary: "The executor stopped before completion.",
    diagnostics: ["Tool runner returned invalid output."],
    runAt: "2026-07-25T15:00:00.000Z"
  };
}
