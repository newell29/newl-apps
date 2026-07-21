import { PlatformRole } from "@prisma/client";
import { NextResponse } from "next/server";

import {
  completeOpenClawTurn,
  failOpenClawTurn,
  listOpenClawUnresolvedTurns,
  startOpenClawTurn,
  type FailOpenClawTurnInput,
  type StartOpenClawTurnInput
} from "@/modules/assistant/openclaw-unresolved-turns";
import { requireRole } from "@/server/auth/authorization";
import {
  authenticateOpenClawAssistantRequest,
  OpenClawAssistantAuthError
} from "@/server/openclaw-assistant-auth";
import { prisma } from "@/server/db";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const context = await authenticateOpenClawAssistantRequest(request);
    const body = await readBody(request);
    if (body.action === "start") {
      const data = await startOpenClawTurn(context, body as StartOpenClawTurnInput);
      return NextResponse.json({ data });
    }
    if (body.action === "complete") {
      const data = await completeOpenClawTurn(context, readString(body.runId, "runId"));
      return NextResponse.json({ data: { removed: data.count > 0 } });
    }
    if (body.action === "fail") {
      const data = await failOpenClawTurn(context, body as FailOpenClawTurnInput);
      return NextResponse.json({ data });
    }
    return NextResponse.json({ error: "Unsupported unresolved-turn action." }, { status: 400 });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function GET(request: Request) {
  try {
    const context = await authenticateOpenClawAssistantRequest(request);
    requireRole(context, [PlatformRole.ADMIN]);
    const url = new URL(request.url);
    const data = await listOpenClawUnresolvedTurns(context, {
      limit: readOptionalInteger(url.searchParams.get("limit")),
      staleAfterSeconds: readOptionalInteger(url.searchParams.get("staleAfterSeconds"))
    });
    await prisma.auditLog.create({
      data: {
        tenantId: context.tenantId,
        actorUserId: context.userId,
        action: "assistant.openclaw_unresolved.list",
        entityType: "OpenClawUnresolvedTurn",
        after: { count: data.length }
      }
    });
    return NextResponse.json({ data: { issues: data } });
  } catch (error) {
    return errorResponse(error);
  }
}

async function readBody(request: Request) {
  const value = await request.json().catch(() => null);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RequestError("Request body must be a JSON object.");
  }
  return value as Record<string, unknown>;
}

function readString(value: unknown, field: string) {
  if (typeof value !== "string" || !value.trim()) throw new RequestError(`${field} is required.`);
  return value.trim();
}

function readOptionalInteger(value: string | null) {
  if (value === null || value === "") return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new RequestError("List options must be positive integers.");
  return parsed;
}

function errorResponse(error: unknown) {
  const status = error instanceof OpenClawAssistantAuthError
    ? error.status
    : error instanceof RequestError
      ? error.status
      : error instanceof Error && error.name === "AuthorizationError"
        ? 403
        : error instanceof Error
          ? 400
          : 500;
  const message = error instanceof Error ? error.message : "OpenClaw unresolved-turn request failed.";
  return NextResponse.json({ error: status >= 500 ? "OpenClaw unresolved-turn request failed." : message }, { status });
}

class RequestError extends Error {
  status = 400;
}
