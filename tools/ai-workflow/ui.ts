import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  answerOwnerQuestion,
  effectivePhaseRisk,
  unresolvedBlockingQuestions
} from "./decisions";
import { reconcilePhaseQuestionGates } from "./feature";
import { findCoordinationRoot, findRepositoryRoot } from "./git";
import { runFeature } from "./launcher";
import type { RunFeatureOptions } from "./launcher";
import type { OperatorReadline } from "./operator-input";
import {
  featureDirectory,
  featureEventsPath,
  FeatureState,
  loadFeatureState,
  saveFeatureState,
  transitionFeatureState,
  validateFeatureSlug
} from "./state";

const MAX_BODY_BYTES = 32 * 1024;
const MAX_EVENT_BYTES = 256 * 1024;
const UI_DIRECTORY = dirname(fileURLToPath(import.meta.url));

type BackgroundJob = {
  status: "running" | "completed" | "failed";
  startedAt: string;
  completedAt: string | null;
  error: string | null;
};

type UiDependencies = {
  runFeature?: typeof runFeature;
};

export type OperatorUi = {
  url: string;
  token: string;
  close: () => Promise<void>;
};

function tokenMatches(expected: string, provided: string | undefined): boolean {
  if (!provided) return false;
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);
  return (
    expectedBuffer.length === providedBuffer.length &&
    timingSafeEqual(expectedBuffer, providedBuffer)
  );
}

function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer"
  });
  response.end(JSON.stringify(value));
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/\b(api[_-]?key|secret|token|password|authorization)\b\s*[:=]\s*([^\s,;]+)/gi, "$1=[REDACTED]")
    .slice(0, 4_000);
}

async function readBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  let body = "";
  for await (const chunk of request) {
    body += chunk.toString();
    if (Buffer.byteLength(body) > MAX_BODY_BYTES) {
      throw new Error("The request body exceeded the local UI safety limit.");
    }
  }
  if (!body) return {};
  const parsed = JSON.parse(body) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("The request body must be a JSON object.");
  }
  return parsed as Record<string, unknown>;
}

async function listStates(coordinationRoot: string): Promise<FeatureState[]> {
  const root = join(coordinationRoot, "tmp", "ai-workflow", "features");
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const states: FeatureState[] = [];
  for (const entry of entries.filter((candidate) => candidate.isDirectory())) {
    try {
      states.push(await loadFeatureState(coordinationRoot, entry.name));
    } catch {
      // Corrupt states remain fail-closed and are not exposed as actionable UI records.
    }
  }
  return states.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

async function recentEvents(coordinationRoot: string, state: FeatureState): Promise<unknown[]> {
  try {
    const contents = await readFile(featureEventsPath(coordinationRoot, state.featureSlug), "utf8");
    const bounded = contents.slice(-MAX_EVENT_BYTES);
    const firstNewline = bounded.indexOf("\n");
    const complete = contents.length > MAX_EVENT_BYTES && firstNewline >= 0
      ? bounded.slice(firstNewline + 1)
      : bounded;
    return complete
      .split(/\r?\n/)
      .filter(Boolean)
      .slice(-60)
      .map((line) => JSON.parse(line) as unknown);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function hasActiveRun(coordinationRoot: string, featureSlug: string): Promise<boolean> {
  try {
    await stat(join(featureDirectory(coordinationRoot, featureSlug), "active-run.json"));
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

function nextPhase(state: FeatureState) {
  if (!state.plan) return null;
  const record = state.phases.find(
    (phase) => phase.status === "pending" || phase.status === "blocked"
  );
  if (!record) return null;
  const phase = state.plan.phases.find((candidate) => candidate.id === record.id);
  return phase ? { ...phase, effectiveRisk: effectivePhaseRisk(phase) } : null;
}

async function featureView(
  coordinationRoot: string,
  state: FeatureState,
  job?: BackgroundJob
) {
  const next = nextPhase(state);
  const activeRun = await hasActiveRun(coordinationRoot, state.featureSlug);
  return {
    featureSlug: state.featureSlug,
    featureTitle: state.featureTitle,
    stage: state.stage,
    updatedAt: state.updatedAt,
    branch: state.branch,
    worktree: state.worktree,
    baseCommit: state.baseCommit,
    headCommit: state.headCommit,
    diffHash: state.currentDiffHash,
    planHash: state.planHash,
    currentPhaseId: state.currentPhaseId,
    finalOutcome: state.finalOutcome,
    models: state.selectedModels,
    phases: state.phases,
    questions: state.questions,
    blockingQuestions: state.questions.filter(
      (question) => question.blocking && !question.confirmedAt
    ).length,
    nextPhase: next,
    correctionBoundary: state.correctionBoundary,
    latestVerification: state.verificationHistory.at(-1) ?? null,
    latestMetrics: state.phaseMetrics.at(-1) ?? null,
    events: await recentEvents(coordinationRoot, state),
    job: job ?? null,
    activeRun,
    actions: {
      canApproveNext:
        !activeRun &&
        Boolean(next && state.planHash) &&
        (state.stage === "awaiting_next_action" ||
          state.stage === "awaiting_phase_approval" ||
          state.stage === "ready") &&
        unresolvedBlockingQuestions(state.questions, next?.id ?? "").length === 0,
      canResumeCorrection: !activeRun && Boolean(state.correctionBoundary),
      correctionNeedsOwner: Boolean(state.correctionBoundary?.ownerActionRequired)
    }
  };
}

function nonInteractiveOperator(): OperatorReadline {
  return {
    question: async () => {
      throw new Error(
        "The local UI cannot answer an unexpected terminal prompt. Resolve the readiness issue and try again."
      );
    }
  };
}

function requirePostOrigin(request: IncomingMessage, port: number): void {
  const origin = request.headers.origin;
  if (
    origin !== `http://127.0.0.1:${port}` &&
    origin !== `http://localhost:${port}`
  ) {
    throw new Error("The local UI rejected an unexpected request origin.");
  }
}

export async function startOperatorUi(input: {
  coordinationRoot: string;
  port?: number;
  token?: string;
  dependencies?: UiDependencies;
}): Promise<OperatorUi> {
  const token = input.token ?? randomBytes(24).toString("base64url");
  const jobs = new Map<string, BackgroundJob>();
  const executeFeature = input.dependencies?.runFeature ?? runFeature;
  const pageTemplate = await readFile(join(UI_DIRECTORY, "ui.html"), "utf8");

  const server = createServer(async (request, response) => {
    try {
      const port = (server.address() as { port: number }).port;
      const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);
      const suppliedToken =
        request.headers["x-newl-ui-token"]?.toString() ?? url.searchParams.get("token") ?? undefined;
      if (!tokenMatches(token, suppliedToken)) {
        json(response, 401, { error: "Local UI authorization failed." });
        return;
      }

      if (request.method === "GET" && url.pathname === "/") {
        const page = pageTemplate.replaceAll("__NEWL_UI_TOKEN__", token);
        response.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
          "Content-Security-Policy": "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
          "X-Content-Type-Options": "nosniff",
          "X-Frame-Options": "DENY",
          "Referrer-Policy": "no-referrer"
        });
        response.end(page);
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/features") {
        const states = await listStates(input.coordinationRoot);
        json(
          response,
          200,
          await Promise.all(
            states.map((state) => featureView(input.coordinationRoot, state, jobs.get(state.featureSlug)))
          )
        );
        return;
      }

      const featureMatch = url.pathname.match(/^\/api\/features\/([a-z0-9-]+)$/);
      if (request.method === "GET" && featureMatch) {
        const slug = validateFeatureSlug(featureMatch[1]);
        const state = await loadFeatureState(input.coordinationRoot, slug);
        json(response, 200, await featureView(input.coordinationRoot, state, jobs.get(slug)));
        return;
      }

      const questionMatch = url.pathname.match(
        /^\/api\/features\/([a-z0-9-]+)\/questions\/([A-Za-z0-9._-]+)$/
      );
      if (request.method === "POST" && questionMatch) {
        requirePostOrigin(request, port);
        const slug = validateFeatureSlug(questionMatch[1]);
        const body = await readBody(request);
        const state = await loadFeatureState(input.coordinationRoot, slug);
        if (await hasActiveRun(input.coordinationRoot, slug)) {
          throw new Error("This feature already has a workflow running; owner decisions are locked.");
        }
        const question = state.questions.find((candidate) => candidate.id === questionMatch[2]);
        if (!question) throw new Error("The owner question was not found.");
        if (
          body.planHash !== question.planHash ||
          body.questionHash !== question.questionHash
        ) {
          throw new Error("The question or plan changed; reload before confirming an answer.");
        }
        const updated = answerOwnerQuestion(
          question,
          typeof body.answer === "string" ? body.answer : "",
          typeof body.explanation === "string" ? body.explanation : null,
          { planHash: question.planHash, questionHash: question.questionHash }
        );
        let nextState: FeatureState = {
          ...state,
          questions: state.questions.map((candidate) =>
            candidate.id === updated.id ? updated : candidate
          ),
          updatedAt: new Date().toISOString()
        };
        nextState = {
          ...nextState,
          phases: reconcilePhaseQuestionGates(nextState.phases, nextState.questions)
        };
        if (
          nextState.stage === "waiting_questions" &&
          nextState.currentPhaseId &&
          unresolvedBlockingQuestions(nextState.questions, nextState.currentPhaseId).length === 0
        ) {
          nextState = transitionFeatureState(nextState, "awaiting_phase_approval");
        }
        await saveFeatureState(input.coordinationRoot, nextState);
        json(response, 200, await featureView(input.coordinationRoot, nextState, jobs.get(slug)));
        return;
      }

      const actionMatch = url.pathname.match(
        /^\/api\/features\/([a-z0-9-]+)\/actions\/(approve-run|resume-correction)$/
      );
      if (request.method === "POST" && actionMatch) {
        requirePostOrigin(request, port);
        const slug = validateFeatureSlug(actionMatch[1]);
        const action = actionMatch[2];
        const body = await readBody(request);
        const state = await loadFeatureState(input.coordinationRoot, slug);
        if (
          jobs.get(slug)?.status === "running" ||
          (await hasActiveRun(input.coordinationRoot, slug))
        ) {
          throw new Error("This feature already has a workflow running.");
        }
        const options: RunFeatureOptions = {};
        if (action === "approve-run") {
          if (
            !["ready", "awaiting_phase_approval", "awaiting_next_action"].includes(state.stage)
          ) {
            throw new Error(`A phase cannot be approved while the feature is ${state.stage}.`);
          }
          const phase = nextPhase(state);
          if (!phase || !state.planHash) throw new Error("No phase is eligible for approval.");
          if (
            body.phaseId !== phase.id ||
            body.planHash !== state.planHash ||
            body.diffHash !== state.currentDiffHash ||
            typeof body.confirmation !== "string"
          ) {
            throw new Error("The approval does not match the current phase, plan, or diff.");
          }
          if (unresolvedBlockingQuestions(state.questions, phase.id).length > 0) {
            throw new Error("Blocking owner questions must be answered before phase approval.");
          }
          const expectedConfirmation =
            phase.effectiveRisk === "high" || phase.effectiveRisk === "owner_gated"
              ? phase.id
              : "approve";
          if (body.confirmation !== expectedConfirmation) {
            throw new Error(`Type ${expectedConfirmation} exactly to approve this phase.`);
          }
          options.phaseApproval = {
            phaseId: phase.id,
            planHash: state.planHash,
            diffHash: state.currentDiffHash,
            confirmation: body.confirmation
          };
        } else {
          if (!state.correctionBoundary) throw new Error("No saved correction boundary exists.");
          if (!['correction_required', 'interrupted', 'paused'].includes(state.stage)) {
            throw new Error(`A saved correction cannot be resumed while the feature is ${state.stage}.`);
          }
          if (
            body.phaseId !== state.correctionBoundary.phaseId ||
            body.diffHash !== state.correctionBoundary.diffHash ||
            state.branch !== state.correctionBoundary.branch ||
            state.baseCommit !== state.correctionBoundary.baseCommit ||
            state.headCommit !== state.correctionBoundary.headCommit ||
            state.currentDiffHash !== state.correctionBoundary.diffHash
          ) {
            throw new Error("The branch, base, HEAD, or diff no longer matches the saved correction boundary.");
          }
          if (state.correctionBoundary.ownerActionRequired) {
            if (body.confirmation !== state.correctionBoundary.phaseId) {
              throw new Error("Type the exact phase ID to authorize another bounded correction.");
            }
            options.allowOwnerCorrectionRetry = true;
          }
        }

        const job: BackgroundJob = {
          status: "running",
          startedAt: new Date().toISOString(),
          completedAt: null,
          error: null
        };
        jobs.set(slug, job);
        void executeFeature(input.coordinationRoot, state, nonInteractiveOperator(), options)
          .then(() => {
            job.status = "completed";
            job.completedAt = new Date().toISOString();
          })
          .catch((error) => {
            job.status = "failed";
            job.completedAt = new Date().toISOString();
            job.error = safeError(error);
          });
        json(response, 202, { status: "running", featureSlug: slug });
        return;
      }

      json(response, 404, { error: "Not found." });
    } catch (error) {
      json(response, 400, { error: safeError(error) });
    }
  });

  const requestedPort = input.port ?? 4317;
  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(requestedPort, "127.0.0.1", () => resolveListen());
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("The local UI did not bind a TCP port.");
  const url = `http://127.0.0.1:${address.port}/?token=${encodeURIComponent(token)}`;
  return {
    url,
    token,
    close: () =>
      new Promise<void>((resolveClose, reject) => {
        server.close((error) => (error ? reject(error) : resolveClose()));
      })
  };
}

export async function runOperatorUi(): Promise<void> {
  const repositoryRoot = await findRepositoryRoot(process.cwd());
  const coordinationRoot = await findCoordinationRoot(repositoryRoot);
  const ui = await startOperatorUi({ coordinationRoot });
  console.log(`\nNewl AI Development Engine is available locally:\n${ui.url}\n`);
  console.log("Keep this process running while using the interface. Press Ctrl+C to stop.");
  await new Promise<void>((resolve) => {
    process.once("SIGINT", resolve);
    process.once("SIGTERM", resolve);
  });
  await ui.close();
}
