import { ModuleKey } from "@prisma/client";
import { NextResponse } from "next/server";

import {
  generateDevelopmentSuggestions,
  listDevelopmentSuggestions
} from "@/modules/assistant/operational-memory";
import { requireAdmin, requireModule, requireMutationAccess } from "@/server/auth/authorization";
import { getAuthenticatedContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

export async function GET() {
  const context = await getAuthenticatedContext();
  await requireModule(context, ModuleKey.SHIPMENT_DOCUMENTS);
  requireAdmin(context);
  return NextResponse.json({ data: await listDevelopmentSuggestions(context) });
}

export async function POST() {
  const context = await getAuthenticatedContext();
  await requireModule(context, ModuleKey.SHIPMENT_DOCUMENTS);
  await requireMutationAccess(context);
  requireAdmin(context);
  const created = await generateDevelopmentSuggestions(context);
  return NextResponse.json({ data: created }, { status: created.length > 0 ? 201 : 200 });
}
