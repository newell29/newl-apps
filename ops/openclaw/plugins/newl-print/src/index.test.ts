import { afterEach, describe, expect, it, vi } from "vitest";
import { getToolPluginMetadata } from "openclaw/plugin-sdk/tool-plugin";

import plugin, {
  createPrintApprovalTool,
  createPrintPlanTool,
  createPrintStatusTool
} from "./index.js";

const trustedContext = {
  messageChannel: "msteams",
  requesterSenderId: "22222222-2222-4222-8222-222222222222"
};
const config = {
  baseUrl: "https://newl.example.com",
  tenantId: "11111111-1111-4111-8111-111111111111"
};

describe("Newl printing OpenClaw plugin", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.OPENCLAW_PRINT_TOKEN;
  });

  it("exposes only single-order plan, approval, and status tools", () => {
    expect(getToolPluginMetadata(plugin)?.tools.map((tool) => tool.name)).toEqual([
      "newl_print_plan",
      "newl_print_approve",
      "newl_print_status"
    ]);
  });

  it("rejects calls without a trusted Teams sender before network access", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const tool = createPrintPlanTool({ config, toolContext: {} });
    await expect(tool.execute("call-1", { shippingOrderNumber: "30666" }))
      .resolves.toMatchObject({ details: { status: "unauthorized" } });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("creates an approval-required plan with the corrected BIXOLON printer", async () => {
    process.env.OPENCLAW_PRINT_TOKEN = "print-token";
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      data: printJob({ status: "PENDING_APPROVAL" })
    }, 201));
    vi.stubGlobal("fetch", fetchMock);
    const tool = createPrintPlanTool({ config, toolContext: trustedContext });

    const result = await tool.execute("call-2", { shippingOrderNumber: "30666" });

    expect(result).toMatchObject({ details: { status: "awaiting_approval" } });
    expect(result.content[0]?.text).toContain("BIXOLON SRP-770III");
    expect(result.content[0]?.text).not.toContain("BPL-Z");
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(request.body))).toMatchObject({
      action: "plan",
      shippingOrderNumber: "30666",
      requestKey: expect.stringMatching(/^[a-f0-9]{64}$/)
    });
  });

  it("does not approve without an explicit true confirmation", async () => {
    process.env.OPENCLAW_PRINT_TOKEN = "print-token";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const tool = createPrintApprovalTool({ config, toolContext: trustedContext });

    await expect(tool.execute("call-3", { jobId: "cmprintjob12345", confirmed: false }))
      .resolves.toMatchObject({ details: { status: "failed" } });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports a completed approval without submitting a second print action", async () => {
    process.env.OPENCLAW_PRINT_TOKEN = "print-token";
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      data: printJob({
        status: "COMPLETED",
        result: {
          documents: [
            { kind: "PICKING_LIST", status: "COMPLETED", printer: "_192_168_1_28", copies: 1 },
            { kind: "BOL", status: "SUBMITTED", printer: "KONICA MINOLTA bizhub C3350i PCL (192.168.1.28) UPD", copies: 1 },
            { kind: "OUTBOUND_LABELS", status: "SUBMITTED", printer: "BIXOLON SRP-770III", copies: 2 }
          ]
        }
      })
    }));
    vi.stubGlobal("fetch", fetchMock);
    const tool = createPrintApprovalTool({ config, toolContext: trustedContext });

    const result = await tool.execute("call-4", { jobId: "cmprintjob12345", confirmed: true });

    expect(result).toMatchObject({ details: { status: "ok" } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.content[0]?.text).toContain("completed");
  });

  it("status never converts a failure into a retry", async () => {
    process.env.OPENCLAW_PRINT_TOKEN = "print-token";
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      data: printJob({ status: "FAILED", errorMessage: "Printer selection changed." })
    }));
    vi.stubGlobal("fetch", fetchMock);
    const tool = createPrintStatusTool({ config, toolContext: trustedContext });
    const result = await tool.execute("call-5", { jobId: "cmprintjob12345" });
    expect(result).toMatchObject({ details: { status: "failed" } });
    expect(result.content[0]?.text).toContain("not retried automatically");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

function printJob(overrides: Record<string, unknown>) {
  return {
    id: "cmprintjob12345",
    shippingOrderNumber: "30666",
    customerName: "Garland Canada Distribution",
    warehouseName: "Annagem",
    status: "PENDING_APPROVAL",
    approvedPalletCount: 2,
    documentPlan: { pickingListCopies: 1, bolCopies: 1, outboundLabelCopies: 2 },
    printerPlan: {
      pickingList: { queue: "_192_168_1_28", displayName: "192.168.1.28" },
      bol: { exactName: "KONICA MINOLTA bizhub C3350i PCL (192.168.1.28) UPD" },
      outboundLabels: { exactName: "BIXOLON SRP-770III" }
    },
    ...overrides
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}
