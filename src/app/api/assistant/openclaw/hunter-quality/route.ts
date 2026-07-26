import { ModuleKey, PlatformRole } from "@prisma/client";
import { NextResponse } from "next/server";

import {
  completeHunterQualityAudit,
  failHunterQualityAudit,
  HunterQualityAuditError,
  prepareHunterQualityAudit
} from "@/modules/lead-gen/hunter-quality-audit";
import {
  AuthorizationError,
  requireModule,
  requireMutationAccess,
  requireRole
} from "@/server/auth/authorization";
import {
  authenticateOpenClawAssistantRequest,
  OpenClawAssistantAuthError
} from "@/server/openclaw-assistant-auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const context = await authenticateOpenClawAssistantRequest(request);
    requireRole(context, [PlatformRole.ADMIN]);
    await requireModule(context, ModuleKey.LEAD_GEN);
    await requireMutationAccess(context);
    const body = await readBody(request);
    const action = readAction(body.action);

    if (action === "prepare") {
      return NextResponse.json({
        data: await prepareHunterQualityAudit(context)
      });
    }
    if (action === "complete") {
      return NextResponse.json({
        data: await completeHunterQualityAudit({
          context,
          runId: readRequiredString(body.runId, "runId", 100),
          completion: body.completion
        })
      });
    }
    return NextResponse.json({
      data: await failHunterQualityAudit({
        context,
        runId: readRequiredString(body.runId, "runId", 100),
        errorMessage: readRequiredString(
          body.errorMessage,
          "errorMessage",
          1_000
        )
      })
    });
  } catch (error) {
    const status =
      error instanceof OpenClawAssistantAuthError ||
      error instanceof HunterQualityAuditError ||
      error instanceof RequestError ||
      error instanceof AuthorizationError
        ? error.status
        : 500;
    return NextResponse.json(
      {
        error:
          status >= 500
            ? "The Hunter quality request failed."
            : error instanceof Error
              ? error.message
              : "The Hunter quality request failed."
      },
      { status }
    );
  }
}

function readAction(value: unknown): "prepare" | "complete" | "fail" {
  if (value === "prepare" || value === "complete" || value === "fail") {
    return value;
  }
  throw new RequestError("Unsupported Hunter quality action.");
}

async function readBody(request: Request) {
  const value = await request.json().catch(() => null);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RequestError("Request body must be a JSON object.");
  }
  return value as Record<string, unknown>;
}

function readRequiredString(value: unknown, field: string, maxLength: number) {
  if (typeof value !== "string" || !value.trim()) {
    throw new RequestError(`${field} is required.`);
  }
  return value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .trim()
    .slice(0, maxLength);
}

class RequestError extends Error {
  status = 400;
}
