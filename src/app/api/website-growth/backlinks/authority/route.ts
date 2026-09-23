import { NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { authenticateWebsiteGrowthBacklinkExecutorRequest, WebsiteGrowthBacklinkExecutorAuthError } from "@/server/website-growth-backlink-executor-auth";
import { record, ScoutWorkError, text } from "@/modules/website-growth/scout/model";
import { authorityExecutionStatus, beginAuthorityAction, claimAuthorityAction, executeAuthorityAction, finishAuthorityAction, prepareAuthorityExecution } from "@/modules/website-growth/authority/store";

export const dynamic = "force-dynamic";
export const maxDuration = 120;
export async function POST(request: Request) {
  try {
    const { tenantSlug } = authenticateWebsiteGrowthBacklinkExecutorRequest(request);
    const tenant = await prisma.tenant.findUnique({ where: { slug: tenantSlug }, select: { id: true } });
    if (!tenant) throw new ScoutWorkError("Executor tenant not found.", 404);
    if (!await prisma.tenantModuleAccess.findFirst({ where: { tenantId: tenant.id, enabled: true, module: { key: "WEBSITE_GROWTH" } }, select: { id: true } })) throw new ScoutWorkError("Website Growth is disabled.", 403);
    const raw = await request.text();
    if (raw.length > 12_000) throw new ScoutWorkError("Request too large.", 413);
    const input = record(JSON.parse(raw));
    if (input.action === "prepare") return NextResponse.json({ data: await prepareAuthorityExecution(tenant.id) });
    if (input.action === "claim") return NextResponse.json({ data: await claimAuthorityAction(tenant.id, text(input.claimId, "Claim ID", 100)) });
    const id = text(input.id, "Action ID", 100), lease = text(input.lease, "Execution lease", 100);
    if (input.action === "status") return NextResponse.json({ data: await authorityExecutionStatus(tenant.id, id, lease) });
    if (input.action === "begin") return NextResponse.json({ data: await beginAuthorityAction(tenant.id, id, lease) });
    if (input.action === "execute") return NextResponse.json({ data: await executeAuthorityAction(tenant.id, id, lease) });
    if (input.action === "finish") return NextResponse.json({ data: await finishAuthorityAction(tenant.id, id, lease, input.result) });
    throw new ScoutWorkError("Unsupported authority action.");
  } catch (error) {
    const known = error instanceof ScoutWorkError || error instanceof WebsiteGrowthBacklinkExecutorAuthError;
    return NextResponse.json({ error: known ? error.message : "Authority step unavailable. Saved state is preserved; never repeat an uncertain external action." }, { status: known ? error.status : 503 });
  }
}
