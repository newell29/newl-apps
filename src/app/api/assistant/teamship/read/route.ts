import { NextResponse } from "next/server";

import { maybeRunAssistantTeamshipRequest } from "@/modules/assistant/teamship-workflow";
import {
  authenticateOpenClawTeamshipRequest,
  OpenClawTeamshipAuthError
} from "@/server/openclaw-teamship-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request: Request) {
  try {
    const context = await authenticateOpenClawTeamshipRequest(request);
    const prompt = await readPrompt(request);
    const response = await maybeRunAssistantTeamshipRequest(context, prompt);

    if (!response) {
      return NextResponse.json(
        { error: "This endpoint accepts only current-record Teamship requests and related clarification prompts." },
        { status: 400 }
      );
    }

    return NextResponse.json({
      data: {
        answer: response.answer,
        intent: response.intent,
        provider: response.provider,
        model: response.model,
        metadata: response.messageMetadata,
        sources: response.sources
      }
    });
  } catch (error) {
    const status = error instanceof OpenClawTeamshipAuthError
      ? error.status
      : error instanceof TeamshipRequestError
        ? error.status
        : 500;
    const message = error instanceof Error ? error.message : "OpenClaw Teamship read failed.";
    return NextResponse.json({ error: status === 500 ? "OpenClaw Teamship read failed." : message }, { status });
  }
}

class TeamshipRequestError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "TeamshipRequestError";
    this.status = status;
  }
}

async function readPrompt(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new TeamshipRequestError("Request body must be valid JSON.");
  }
  const prompt = body && typeof body === "object" && typeof (body as Record<string, unknown>).prompt === "string"
    ? (body as Record<string, string>).prompt.trim()
    : "";
  if (!prompt || prompt.length > 4_000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(prompt)) {
    throw new TeamshipRequestError("prompt must be between 1 and 4000 printable characters.");
  }
  return prompt;
}
