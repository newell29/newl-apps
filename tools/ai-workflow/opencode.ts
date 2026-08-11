import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

import { sanitizeCommandOutput } from "./verification";

export type AgentRole = "planner" | "builder" | "reviewer";

export type AgentRunRequest = {
  role: AgentRole;
  model: string;
  prompt: string;
  sessionId?: string;
};

export type AgentRunResult = {
  text: string;
  cost: number | null;
  sessionId?: string;
  assistantMessageId?: string;
  textPartIds?: string[];
  finishReason?: string;
  tokens?: {
    input: number;
    output: number;
    reasoning: number;
    cacheRead: number;
  };
};

export interface AgentRunner {
  run(request: AgentRunRequest): Promise<AgentRunResult>;
}

export type OpenCodeProgressEvent = {
  role: AgentRole;
  type: "started" | "active" | "heartbeat" | "completed" | "failed";
  elapsedMs: number;
};

export type OpenCodeCatalog = {
  version: string;
  modelIds: string[];
  authenticatedProviders: string[];
  agentNames: string[];
};

export interface OpenCodeInspector {
  inspect(): Promise<OpenCodeCatalog>;
}

const RESULT_OPEN = "<AI_WORKFLOW_RESULT>";
const RESULT_CLOSE = "</AI_WORKFLOW_RESULT>";
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;

function safeEnvironment(): NodeJS.ProcessEnv {
  const allowedKeys = [
    "PATH",
    "HOME",
    "USER",
    "LOGNAME",
    "SHELL",
    "TERM",
    "COLORTERM",
    "TMPDIR",
    "TMP",
    "TEMP",
    "XDG_CONFIG_HOME",
    "XDG_DATA_HOME",
    "XDG_CACHE_HOME",
    "NO_COLOR",
    "CI",
    "OPENCODE_CONFIG",
    "OPENCODE_CONFIG_DIR",
    "OPENCODE_DISABLE_AUTOUPDATE"
  ];
  const environment: NodeJS.ProcessEnv = {
    NODE_ENV: process.env.NODE_ENV ?? "production"
  };

  for (const key of allowedKeys) {
    if (process.env[key] !== undefined) {
      environment[key] = process.env[key];
    }
  }

  environment.NO_COLOR = "1";
  environment.OPENCODE_DISABLE_AUTOUPDATE = "true";
  return environment;
}

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;]*m/g, "");
}

function resolveOpenCodeBinary(repositoryRoot: string, binary?: string): string {
  return resolve(
    binary ?? process.env.OPENCODE_BIN ?? join(repositoryRoot, "node_modules", ".bin", "opencode")
  );
}

async function runOpenCodeCommand(binary: string, repositoryRoot: string, args: string[]): Promise<string> {
  if (!existsSync(binary)) {
    throw new Error(
      `OpenCode was not found at ${binary}. Run npm install or set OPENCODE_BIN to an absolute executable path.`
    );
  }
  return new Promise((resolveOutput, reject) => {
    const child = spawn(binary, args, {
      cwd: repositoryRoot,
      env: safeEnvironment(),
      shell: false,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      if (Buffer.byteLength(stdout) > MAX_OUTPUT_BYTES) child.kill("SIGTERM");
    });
    child.stderr.on("data", (chunk: string) => {
      if (Buffer.byteLength(stderr) < MAX_OUTPUT_BYTES) stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0 && Buffer.byteLength(stdout) <= MAX_OUTPUT_BYTES) {
        resolveOutput(stripAnsi(stdout));
        return;
      }
      reject(
        new Error(
          `OpenCode ${args.join(" ")} failed with exit code ${code ?? "unknown"}: ${
            sanitizeCommandOutput(stripAnsi(stderr)).trim() || "no error output"
          }`
        )
      );
    });
  });
}

type TextCandidate = {
  text: string;
  sessionId?: string;
  messageId?: string;
  partId?: string;
};

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  return typeof record[key] === "string" && record[key] ? (record[key] as string) : undefined;
}

function collectText(
  value: unknown,
  output: TextCandidate[],
  inherited: { sessionId?: string; messageId?: string } = {}
): void {
  if (Array.isArray(value)) {
    for (const item of value) collectText(item, output, inherited);
    return;
  }
  if (!value || typeof value !== "object") return;

  const record = value as Record<string, unknown>;
  const sessionId = stringField(record, "sessionID") ?? inherited.sessionId;
  const messageId = stringField(record, "messageID") ?? inherited.messageId;
  const type = stringField(record, "type");
  const nestedPart = record.part;
  if (
    type === "text" &&
    nestedPart &&
    typeof nestedPart === "object" &&
    !Array.isArray(nestedPart) &&
    typeof (nestedPart as Record<string, unknown>).text === "string"
  ) {
    const part = nestedPart as Record<string, unknown>;
    output.push({
      text: part.text as string,
      sessionId: stringField(part, "sessionID") ?? sessionId,
      messageId: stringField(part, "messageID") ?? messageId,
      partId: stringField(part, "id")
    });
  }
  if (type === "text" && typeof record.text === "string") {
    output.push({
      text: record.text,
      sessionId,
      messageId,
      partId: stringField(record, "id")
    });
  }
  for (const [key, nested] of Object.entries(record)) {
    if (key !== "text" && !(key === "part" && type === "text")) {
      collectText(nested, output, { sessionId, messageId });
    }
  }
}

function eventCost(value: unknown): number | null {
  if (!value || typeof value !== "object") return null;
  const event = value as Record<string, unknown>;
  const part = event.part;
  if (!part || typeof part !== "object") return null;
  const cost = (part as Record<string, unknown>).cost;
  return typeof cost === "number" && Number.isFinite(cost) && cost >= 0 ? cost : null;
}

function eventCompletionMetadata(value: unknown): Pick<AgentRunResult, "finishReason" | "tokens"> {
  if (!value || typeof value !== "object") return {};
  const event = value as Record<string, unknown>;
  if (event.type !== "step_finish" || !event.part || typeof event.part !== "object") return {};
  const part = event.part as Record<string, unknown>;
  const tokens = part.tokens;
  let parsedTokens: AgentRunResult["tokens"];
  if (tokens && typeof tokens === "object" && !Array.isArray(tokens)) {
    const record = tokens as Record<string, unknown>;
    const cache = record.cache;
    const cacheRead =
      cache && typeof cache === "object" && !Array.isArray(cache)
        ? (cache as Record<string, unknown>).read
        : undefined;
    const numeric = (candidate: unknown) =>
      typeof candidate === "number" && Number.isFinite(candidate) && candidate >= 0 ? candidate : 0;
    parsedTokens = {
      input: numeric(record.input),
      output: numeric(record.output),
      reasoning: numeric(record.reasoning),
      cacheRead: numeric(cacheRead)
    };
  }
  return {
    finishReason: stringField(part, "reason") ?? stringField(part, "finish"),
    tokens: parsedTokens
  };
}

export function parseOpenCodeOutput(stdout: string): AgentRunResult {
  const texts: TextCandidate[] = [];
  const costs: number[] = [];
  let completionMetadata: Pick<AgentRunResult, "finishReason" | "tokens"> = {};

  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const event: unknown = JSON.parse(line);
      collectText(event, texts);
      const cost = eventCost(event);
      if (cost !== null) costs.push(cost);
      const metadata = eventCompletionMetadata(event);
      if (metadata.finishReason || metadata.tokens) completionMetadata = metadata;
    } catch {
      texts.push({ text: line });
    }
  }

  const completeText = [...texts]
    .reverse()
    .find((candidate) =>
      candidate.text.includes(RESULT_OPEN) && candidate.text.includes(RESULT_CLOSE)
    );
  const selected = completeText ?? texts.at(-1);
  const text = completeText?.text ?? texts.map((candidate) => candidate.text).join("");

  return {
    text,
    cost: costs.length > 0 ? costs.reduce((total, cost) => total + cost, 0) : null,
    sessionId: selected?.sessionId,
    assistantMessageId: selected?.messageId,
    textPartIds: [
      ...new Set(texts.map((candidate) => candidate.partId).filter((id): id is string => Boolean(id)))
    ],
    ...completionMetadata
  };
}

export function extractStructuredResult(text: string): unknown {
  const start = text.indexOf(RESULT_OPEN);
  if (start < 0) {
    throw new Error("The model response did not contain the opening structured result envelope.");
  }
  const end = text.indexOf(RESULT_CLOSE, start + RESULT_OPEN.length);
  if (end < 0) {
    throw new Error("The model response started a structured result but was truncated before the closing envelope.");
  }

  const json = text.slice(start + RESULT_OPEN.length, end).trim();
  try {
    return JSON.parse(json) as unknown;
  } catch (error) {
    throw new Error(
      `The model returned invalid JSON: ${error instanceof Error ? error.message : "unknown parse error"}`
    );
  }
}

export class OpenCodeCliRunner implements AgentRunner {
  private readonly binary: string;

  constructor(
    private readonly repositoryRoot: string,
    binary?: string,
    private readonly onProgress?: (event: OpenCodeProgressEvent) => void
  ) {
    this.binary = resolveOpenCodeBinary(repositoryRoot, binary);
  }

  async run(request: AgentRunRequest): Promise<AgentRunResult> {
    if (!existsSync(this.binary)) {
      throw new Error(
        `OpenCode was not found at ${this.binary}. Run npm install or set OPENCODE_BIN to an absolute executable path.`
      );
    }

    const args = [
      "run",
      "--pure",
      "--model",
      request.model,
      "--agent",
      `newl-ai-${request.role}`,
      "--format",
      "json",
      "--dir",
      this.repositoryRoot
    ];
    if (request.sessionId) {
      if (!/^ses_[A-Za-z0-9_-]{6,128}$/.test(request.sessionId)) {
        throw new Error("OpenCode session ID is malformed.");
      }
      args.push("--session", request.sessionId);
    } else {
      args.push("--title", `Newl AI workflow ${request.role}`);
    }
    args.push("--", request.prompt);

    const startedAt = Date.now();
    this.onProgress?.({ role: request.role, type: "started", elapsedMs: 0 });
    const stdout = await new Promise<string>((resolveOutput, reject) => {
      const child = spawn(this.binary, args, {
        cwd: this.repositoryRoot,
        env: safeEnvironment(),
        shell: false,
        stdio: ["ignore", "pipe", "pipe"]
      });
      let output = "";
      let errorOutput = "";
      let reportedActive = false;
      const heartbeat = setInterval(() => {
        this.onProgress?.({
          role: request.role,
          type: "heartbeat",
          elapsedMs: Date.now() - startedAt
        });
      }, 15_000);
      heartbeat.unref();

      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        output += chunk;
        if (!reportedActive) {
          reportedActive = true;
          this.onProgress?.({
            role: request.role,
            type: "active",
            elapsedMs: Date.now() - startedAt
          });
        }
        if (Buffer.byteLength(output) > MAX_OUTPUT_BYTES) {
          child.kill("SIGTERM");
          reject(new Error("OpenCode output exceeded the 8 MB safety limit."));
        }
      });
      child.stderr.on("data", (chunk: string) => {
        if (Buffer.byteLength(errorOutput) < MAX_OUTPUT_BYTES) errorOutput += chunk;
      });
      child.on("error", (error) => {
        clearInterval(heartbeat);
        this.onProgress?.({
          role: request.role,
          type: "failed",
          elapsedMs: Date.now() - startedAt
        });
        reject(error);
      });
      child.on("close", (code) => {
        clearInterval(heartbeat);
        if (code === 0) {
          this.onProgress?.({
            role: request.role,
            type: "completed",
            elapsedMs: Date.now() - startedAt
          });
          resolveOutput(output);
          return;
        }
        this.onProgress?.({
          role: request.role,
          type: "failed",
          elapsedMs: Date.now() - startedAt
        });
        reject(
          new Error(
            `OpenCode ${request.role} failed with exit code ${code ?? "unknown"}: ${
              sanitizeCommandOutput(errorOutput).trim() || "no error output"
            }`
          )
        );
      });
    });

    return parseOpenCodeOutput(stdout);
  }
}

export class OpenCodeCliInspector implements OpenCodeInspector {
  private readonly binary: string;

  constructor(private readonly repositoryRoot: string, binary?: string) {
    this.binary = resolveOpenCodeBinary(repositoryRoot, binary);
  }

  async inspect(): Promise<OpenCodeCatalog> {
    const [versionOutput, modelsOutput, authOutput, agentsOutput] = await Promise.all([
      runOpenCodeCommand(this.binary, this.repositoryRoot, ["--version"]),
      runOpenCodeCommand(this.binary, this.repositoryRoot, ["models", "--pure"]),
      runOpenCodeCommand(this.binary, this.repositoryRoot, ["auth", "list", "--pure"]),
      runOpenCodeCommand(this.binary, this.repositoryRoot, ["agent", "list", "--pure"])
    ]);

    const modelIds = modelsOutput
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(line));
    const authenticatedProviders = authOutput
      .split(/\r?\n/)
      .map((line) => line.match(/^[●○]\s+(.+?)\s+(?:api|oauth|wellknown)\s*$/i)?.[1]?.trim())
      .filter((provider): provider is string => Boolean(provider));
    const agentNames = agentsOutput
      .split(/\r?\n/)
      .map((line) => line.match(/^([A-Za-z0-9][A-Za-z0-9._-]*)\s+\((?:primary|subagent|all)\)\s*$/)?.[1])
      .filter((agent): agent is string => Boolean(agent));

    return {
      version: versionOutput.trim(),
      modelIds: [...new Set(modelIds)].sort(),
      authenticatedProviders: [...new Set(authenticatedProviders)].sort(),
      agentNames: [...new Set(agentNames)].sort()
    };
  }
}
