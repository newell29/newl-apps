import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

import { sanitizeCommandOutput } from "./verification";

export type AgentRole = "planner" | "builder" | "reviewer";

export type AgentRunRequest = {
  role: AgentRole;
  model: string;
  prompt: string;
};

export type AgentRunResult = {
  text: string;
  cost: number | null;
};

export interface AgentRunner {
  run(request: AgentRunRequest): Promise<AgentRunResult>;
}

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

function collectText(value: unknown, output: string[]): void {
  if (Array.isArray(value)) {
    for (const item of value) collectText(item, output);
    return;
  }
  if (!value || typeof value !== "object") return;

  const record = value as Record<string, unknown>;
  if (typeof record.text === "string") output.push(record.text);
  for (const [key, nested] of Object.entries(record)) {
    if (key !== "text") collectText(nested, output);
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

export function parseOpenCodeOutput(stdout: string): AgentRunResult {
  const texts: string[] = [];
  const costs: number[] = [];

  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const event: unknown = JSON.parse(line);
      collectText(event, texts);
      const cost = eventCost(event);
      if (cost !== null) costs.push(cost);
    } catch {
      texts.push(line);
    }
  }

  const completeText = [...texts]
    .reverse()
    .find((text) => text.includes(RESULT_OPEN) && text.includes(RESULT_CLOSE));
  const text = completeText ?? texts.join("");

  return {
    text,
    cost: costs.length > 0 ? costs.reduce((total, cost) => total + cost, 0) : null
  };
}

export function extractStructuredResult(text: string): unknown {
  const start = text.indexOf(RESULT_OPEN);
  const end = text.indexOf(RESULT_CLOSE, start + RESULT_OPEN.length);
  if (start < 0 || end < 0) {
    throw new Error("The model response did not contain the required structured result envelope.");
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

  constructor(private readonly repositoryRoot: string, binary?: string) {
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
      this.repositoryRoot,
      "--title",
      `Newl AI workflow ${request.role}`,
      "--",
      request.prompt
    ];

    const stdout = await new Promise<string>((resolveOutput, reject) => {
      const child = spawn(this.binary, args, {
        cwd: this.repositoryRoot,
        env: safeEnvironment(),
        shell: false,
        stdio: ["ignore", "pipe", "pipe"]
      });
      let output = "";
      let errorOutput = "";

      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        output += chunk;
        if (Buffer.byteLength(output) > MAX_OUTPUT_BYTES) {
          child.kill("SIGTERM");
          reject(new Error("OpenCode output exceeded the 8 MB safety limit."));
        }
      });
      child.stderr.on("data", (chunk: string) => {
        if (Buffer.byteLength(errorOutput) < MAX_OUTPUT_BYTES) errorOutput += chunk;
      });
      child.on("error", reject);
      child.on("close", (code) => {
        if (code === 0) {
          resolveOutput(output);
          return;
        }
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
