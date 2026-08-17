import { buildTmgOrderApproval } from "@/modules/shipment-documents/tmg-execution-jobs";
import {
  executeApprovedTmgTeamshipCreatePlan,
  type TmgTeamshipCreatePlan
} from "@/modules/shipment-documents/tmg-teamship-create";
import { executeTmgTeamshipDocumentUpload } from "@/modules/shipment-documents/tmg-teamship-document-upload";
import type { TeamshipRuntimeCredentials } from "@/server/integrations/teamship";

type ClaimedJob = {
  id: string;
  tenantId: string;
  approval: { approvedByUserId: string; approvedAt: string };
  orders: Array<{
    id: string;
    customerReference: string;
    plan: TmgTeamshipCreatePlan;
    fileName: string;
    fileHash: string;
    fileBytesBase64: string;
  }>;
};

async function main() {
  const baseUrl = requireOption("TMG_WORKER_BASE_URL").replace(/\/$/, "");
  const token = requireOption("INGESTION_API_TOKEN");
  const workerId = process.env.TMG_WORKER_ID?.trim() || "tmg-teamship-worker";
  if (process.env.TMG_ALLOW_LIVE_WRITES !== "true") {
    throw new Error("Set TMG_ALLOW_LIVE_WRITES=true only on the approved TMG worker before live Teamship writes can run.");
  }
  const claim = await api<{ job: ClaimedJob | null; teamshipCredentials: TeamshipRuntimeCredentials | null }>(
    `${baseUrl}/api/operations/tmg-order-intake/worker/next`, token, workerId
  );
  if (!claim.job || !claim.teamshipCredentials) {
    console.log("No approved TMG Teamship job is waiting.");
    return;
  }
  const job = claim.job;
  for (const order of job.orders) {
    let failureStage: "CREATE" | "UPLOAD" = "CREATE";
    try {
      await checkpoint(baseUrl, token, workerId, job.id, { event: "CREATE_STARTED", orderId: order.id });
      const createEvidence = await executeApprovedTmgTeamshipCreatePlan({
        tenantId: job.tenantId,
        plan: order.plan,
        approval: buildTmgOrderApproval(order.plan, job.approval),
        credentials: claim.teamshipCredentials
      });
      await checkpoint(baseUrl, token, workerId, job.id, { event: "TEAMSHIP_CREATED", orderId: order.id, evidence: createEvidence });
      await checkpoint(baseUrl, token, workerId, job.id, { event: "UPLOAD_STARTED", orderId: order.id });
      failureStage = "UPLOAD";
      const uploadEvidence = await executeTmgTeamshipDocumentUpload({
        credentials: claim.teamshipCredentials,
        job: {
          id: order.id,
          status: "APPROVED",
          customerReference: order.customerReference,
          teamshipOrderId: createEvidence.teamshipOrderId,
          fileName: order.fileName,
          fileBytes: Buffer.from(order.fileBytesBase64, "base64"),
          fileHash: order.fileHash,
          requestHash: order.plan.requestHash,
          approvedRequestHash: order.plan.requestHash
        },
        options: {
          allowLiveUpload: true,
          browserExecutablePath: process.env.TEAMSHIP_BROWSER_EXECUTABLE_PATH,
          headed: process.env.TMG_BROWSER_HEADED === "true",
          slowMoMs: Number(process.env.TMG_BROWSER_SLOW_MO_MS ?? 0)
        }
      });
      await checkpoint(baseUrl, token, workerId, job.id, { event: "DOCUMENT_UPLOADED", orderId: order.id, evidence: uploadEvidence });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown TMG worker failure.";
      await checkpoint(baseUrl, token, workerId, job.id, {
        event: "ORDER_FAILED",
        orderId: order.id,
        stage: failureStage,
        message
      }).catch(() => undefined);
    }
  }
  await api(`${baseUrl}/api/operations/tmg-order-intake/worker/${encodeURIComponent(job.id)}/complete`, token, workerId);
}

function checkpoint(baseUrl: string, token: string, workerId: string, jobId: string, body: unknown) {
  return api(`${baseUrl}/api/operations/tmg-order-intake/worker/${encodeURIComponent(jobId)}/checkpoint`, token, workerId, body);
}

async function api<T = unknown>(url: string, token: string, workerId: string, body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "x-newl-agent-id": workerId, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const json = await response.json().catch(() => null) as (T & { error?: string }) | null;
  if (!response.ok) throw new Error(json?.error ?? `TMG worker request failed with status ${response.status}.`);
  return json as T;
}

function requireOption(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
