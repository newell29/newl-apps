import { ModuleKey } from "@prisma/client";
import { NextResponse } from "next/server";

import {
  listTmgOrderIntakeBatches,
  syncTmgEmailIntake
} from "@/modules/shipment-documents/tmg-email-intake";
import { requireModule, requireMutationAccess } from "@/server/auth/authorization";
import { getAuthenticatedContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  const context = await getAuthenticatedContext();
  await requireModule(context, ModuleKey.SHIPMENT_DOCUMENTS);
  const limit = Number.parseInt(new URL(request.url).searchParams.get("limit") ?? "25", 10);
  return NextResponse.json({ batches: serialize(await listTmgOrderIntakeBatches(context.tenantId, limit)) });
}

export async function POST() {
  const context = await getAuthenticatedContext();
  await requireModule(context, ModuleKey.SHIPMENT_DOCUMENTS);
  await requireMutationAccess(context);
  try {
    const sync = await syncTmgEmailIntake(context);
    return NextResponse.json({ sync, batches: serialize(await listTmgOrderIntakeBatches(context.tenantId, 25)) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to scan the TMG mailbox." }, { status: 502 });
  }
}

function serialize<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
