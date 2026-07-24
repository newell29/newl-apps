import { PlatformRole } from "@prisma/client";
import { NextResponse } from "next/server";

import {
  claimRivetDevelopmentJob,
  RivetDevelopmentJobError,
  updateRivetDevelopmentJob
} from "@/modules/assistant/rivet-development-jobs";
import {
  AuthorizationError,
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
    await requireMutationAccess(context);
    const body = await readBody(request);
    const action = readAction(body.action);

    if (action === "claim") {
      return NextResponse.json({ data: await claimRivetDevelopmentJob(context) });
    }

    return NextResponse.json({
      data: await updateRivetDevelopmentJob(context, {
        action,
        jobId: readRequiredString(body.jobId, "jobId", 100),
        leaseToken: readRequiredString(body.leaseToken, "leaseToken", 200),
        progressMessage: readOptionalString(body.progressMessage, 500),
        branchName: readOptionalString(body.branchName, 140),
        commitSha: readOptionalString(body.commitSha, 64),
        pullRequestUrls: readStringArray(body.pullRequestUrls, 5, 500),
        summary: readOptionalString(body.summary, 4000),
        tests: readStringArray(body.tests, 20, 500),
        knownLimitations: readStringArray(body.knownLimitations, 20, 500),
        errorCode: readOptionalString(body.errorCode, 80),
        errorMessage: readOptionalString(body.errorMessage, 1000)
      })
    });
  } catch (error) {
    return errorResponse(error);
  }
}

function readAction(value: unknown): "claim" | "progress" | "complete" | "fail" {
  if (value === "claim" || value === "progress" || value === "complete" || value === "fail") {
    return value;
  }
  throw new RequestError("Unsupported Rivet development action.");
}

async function readBody(request: Request) {
  const value = await request.json().catch(() => null);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RequestError("Request body must be a JSON object.");
  }
  return value as Record<string, unknown>;
}

function readRequiredString(value: unknown, field: string, maxLength: number) {
  const normalized = readOptionalString(value, maxLength);
  if (!normalized) throw new RequestError(`${field} is required.`);
  return normalized;
}

function readOptionalString(value: unknown, maxLength: number) {
  return typeof value === "string"
    ? value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, maxLength) || null
    : null;
}

function readStringArray(value: unknown, limit: number, maxLength: number) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, maxLength))
    .filter(Boolean)
    .slice(0, limit);
}

function errorResponse(error: unknown) {
  const status = error instanceof OpenClawAssistantAuthError ||
    error instanceof RivetDevelopmentJobError ||
    error instanceof RequestError ||
    error instanceof AuthorizationError
    ? error.status
    : 500;
  const message = status >= 500
    ? "The Rivet development request failed."
    : error instanceof Error
      ? error.message
      : "The Rivet development request failed.";
  return NextResponse.json({ error: message }, { status });
}

class RequestError extends Error {
  status = 400;
}
