import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createApiTool,
  createBusinessProfileTool,
  createDirectoryCredentialFillTool,
  createParameterizedApiTool,
  readApprovedBusinessProfile
} from "./index.js";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

describe("Newl Website Growth OpenClaw plugin", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.TEST_BACKLINK_TOKEN;
    delete process.env.TEST_DIRECTORY_MASTER;
  });

  it("does not call Newl Apps when the protected token is missing", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const tool = createApiTool("newl_backlink_claim", "/claim", { limit: 5 })({
      config: {
        baseUrl: "https://newl-apps.example.com",
        backlinkTokenEnv: "TEST_BACKLINK_TOKEN"
      }
    });

    const result = await tool.execute();

    expect(result.details.status).toBe("not_configured");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("binds the token outside model-controlled arguments", async () => {
    process.env.TEST_BACKLINK_TOKEN = "protected-token";
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: { updated: true } }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    const tool = createParameterizedApiTool("newl_backlink_report", "/report")({
      config: {
        baseUrl: "https://newl-apps.example.com/",
        backlinkTokenEnv: "TEST_BACKLINK_TOKEN"
      }
    });

    const result = await tool.execute("call-1", {
      opportunityId: "opportunity-1",
      status: "BLOCKED",
      notes: "CAPTCHA requires human review."
    });

    expect(result.details.status).toBe("ok");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://newl-apps.example.com/report",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer protected-token"
        })
      })
    );
  });

  it("registers each factory under its declared OpenClaw tool name", () => {
    const config = {
      baseUrl: "https://newl-apps.example.com",
      backlinkTokenEnv: "TEST_BACKLINK_TOKEN"
    };
    expect(
      createApiTool("newl_backlink_claim", "/claim", { limit: 5 })({ config }).name
    ).toBe("newl_backlink_claim");
    expect(
      createParameterizedApiTool("newl_backlink_send_email", "/send")({ config }).name
    ).toBe("newl_backlink_send_email");
    expect(createBusinessProfileTool()({ config }).name).toBe(
      "newl_backlink_business_profile"
    );
  });

  it("returns only a bounded owner-approved public business profile", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "newl-profile-"));
    const profilePath = path.join(directory, "profile.json");
    await writeFile(profilePath, JSON.stringify({
      status: "OWNER_APPROVED_2099-01-01",
      legalEntities: {
        CA: { legalName: "Example Logistics Ltd.", publicAddress: "Example address" },
        US: { legalName: "Example Logistics USA Inc.", publicAddress: "Example address" }
      },
      publicBrandName: "Example Logistics",
      website: "https://example.com",
      senderName: "Example Sender",
      publicDescriptions: {
        short: "Public description",
        medium: "Public description",
        long: "Public description"
      },
      publicLocations: ["Example City"],
      publicPhone: "555-0100",
      outreachMailbox: "user@example.com",
      approvedLogos: [],
      approvedServiceCategories: ["Warehousing"],
      approvedSocialProfiles: [],
      certifications: [],
      forbiddenClaims: ["Do not mention customers."],
      outreachPolicy: {
        countries: ["CA", "US"],
        manualOpportunityApproval: true
      },
      submissionRules: {
        freeListingsOnly: true,
        allowPayment: false
      },
      privateNotes: "must not leave the protected file"
    }));

    try {
      const profile = await readApprovedBusinessProfile(profilePath);
      expect(profile.publicBrandName).toBe("Example Logistics");
      expect(profile).not.toHaveProperty("privateNotes");

      const result = await createBusinessProfileTool()({
        config: {
          baseUrl: "https://newl-apps.example.com",
          businessProfilePath: profilePath
        }
      }).execute();
      expect(result.details.status).toBe("ok");
      expect(result.content[0].text).not.toContain("privateNotes");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects an unapproved or payment-enabled business profile", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "newl-profile-"));
    const profilePath = path.join(directory, "profile.json");
    const baseProfile = {
      status: "OWNER_COMPLETION_REQUIRED",
      outreachPolicy: { manualOpportunityApproval: true },
      submissionRules: { allowPayment: false }
    };
    await writeFile(profilePath, JSON.stringify(baseProfile));

    try {
      await expect(readApprovedBusinessProfile(profilePath)).rejects.toThrow(
        "not owner approved"
      );
      await writeFile(profilePath, JSON.stringify({
        ...baseProfile,
        status: "OWNER_APPROVED_2099-01-01",
        submissionRules: { allowPayment: true }
      }));
      await expect(readApprovedBusinessProfile(profilePath)).rejects.toThrow(
        "Paid backlink execution must remain disabled"
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("passes the executor run start time to the deterministic summary", async () => {
    process.env.TEST_BACKLINK_TOKEN = "protected-token";
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: { blockedThisRun: 1, blockedTotal: 5 } }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    const tool = createParameterizedApiTool("newl_backlink_summary", "/summary")({
      config: {
        baseUrl: "https://newl-apps.example.com",
        backlinkTokenEnv: "TEST_BACKLINK_TOKEN"
      }
    });

    await tool.execute("call-summary", {
      runStartedAt: "2026-07-27T14:00:00.000Z"
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://newl-apps.example.com/summary",
      expect.objectContaining({
        body: JSON.stringify({
          runStartedAt: "2026-07-27T14:00:00.000Z"
        })
      })
    );
  });

  it("never substitutes a model-provided directory master", async () => {
    process.env.TEST_BACKLINK_TOKEN = "protected-token";
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        data: {
          opportunityId: "opportunity-1",
          credentialRef: "directory:v1:opaque",
          sourceOrigin: "https://directory.example",
          username: "partnerships@newlgroup.com",
          version: 1
        }
      }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    const tool = createDirectoryCredentialFillTool()({
      config: {
        baseUrl: "https://newl-apps.example.com",
        backlinkTokenEnv: "TEST_BACKLINK_TOKEN",
        directoryPasswordMasterEnv: "TEST_DIRECTORY_MASTER"
      }
    });

    const result = await tool.execute("call-directory", {
      opportunityId: "opportunity-1",
      targetId: "target-1",
      usernameRef: "username-ref",
      passwordRef: "password-ref",
      confirmPasswordRef: "confirm-ref",
      master: "model-controlled-value"
    });

    expect(result.details.status).toBe("failed");
    expect(result.content[0].text).toContain(
      "protected directory credential master"
    );
    expect(result.content[0].text).not.toContain("model-controlled-value");
  });
});
