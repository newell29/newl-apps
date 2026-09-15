import { ModuleKey } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getContext = vi.hoisted(() => vi.fn());
const requireModule = vi.hoisted(() => vi.fn());
const requireMutationAccess = vi.hoisted(() => vi.fn());
const reprocessBatch = vi.hoisted(() => vi.fn());

vi.mock("@/server/tenant-context", () => ({ getAuthenticatedContext: getContext }));
vi.mock("@/server/auth/authorization", () => ({ requireModule, requireMutationAccess }));
vi.mock("@/modules/shipment-documents/tmg-email-intake", () => ({
  reprocessTmgOrderIntakeBatch: reprocessBatch,
  TmgIntakeError: class TmgIntakeError extends Error {
    status: number;
    constructor(message: string, status = 409) {
      super(message);
      this.status = status;
    }
  }
}));

import { POST } from "@/app/api/operations/tmg-order-intake/batches/[batchId]/reprocess/route";

describe("TMG batch reprocessing route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getContext.mockResolvedValue({ tenantId: "tenant-example", userId: "user-example" });
    reprocessBatch.mockResolvedValue({ id: "batch-example", status: "READY_FOR_APPROVAL" });
  });

  it("requires authenticated module and mutation access before tenant-scoped reprocessing", async () => {
    const response = await POST(new Request("https://example.test/reprocess", { method: "POST" }), {
      params: Promise.resolve({ batchId: "batch-example" })
    });

    expect(response.status).toBe(200);
    expect(requireModule).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: "tenant-example" }),
      ModuleKey.SHIPMENT_DOCUMENTS
    );
    expect(requireMutationAccess).toHaveBeenCalledWith(expect.objectContaining({ userId: "user-example" }));
    expect(reprocessBatch).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: "tenant-example", userId: "user-example" }),
      "batch-example"
    );
  });
});
