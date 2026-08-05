import { spawn } from "node:child_process";

const MAX_CAPTURE_BYTES = 1024 * 1024;
const MAX_REPORTED_CHARACTERS = 24_000;

export type CommandSpec = {
  name: "diff-check" | "typecheck" | "lint" | "build" | "tests";
  command: string;
  args: string[];
};

export type CommandResult = CommandSpec & {
  passed: boolean;
  exitCode: number | null;
  durationMs: number;
  output: string;
};

export type VerificationResult = {
  passed: boolean;
  commands: CommandResult[];
};

export interface CommandRunner {
  run(spec: CommandSpec, cwd: string): Promise<CommandResult>;
}

function verificationEnvironment(spec: CommandSpec): NodeJS.ProcessEnv {
  const allowedKeys = [
    "PATH",
    "HOME",
    "USER",
    "LOGNAME",
    "SHELL",
    "TERM",
    "TMPDIR",
    "TMP",
    "TEMP",
    "CI",
    "NO_COLOR",
    "NPM_CONFIG_CACHE",
    "npm_config_cache"
  ];
  const environment: NodeJS.ProcessEnv = {
    NODE_ENV:
      spec.name === "tests"
        ? "test"
        : spec.name === "build"
          ? "production"
          : process.env.NODE_ENV ?? "production"
  };
  for (const key of allowedKeys) {
    if (process.env[key] !== undefined) environment[key] = process.env[key];
  }
  environment.CI = "1";
  environment.NO_COLOR = "1";
  return environment;
}

export function sanitizeCommandOutput(output: string): string {
  const sanitized = output
    .replace(
      /\b(api[_-]?key|secret|token|password|private[_-]?key|database_url|authorization)\b\s*[:=]\s*([^\s,;]+)/gi,
      "$1=[REDACTED]"
    )
    .replace(/\b(sk-[A-Za-z0-9_-]{12,}|gh[opsu]_[A-Za-z0-9_]{12,})\b/g, "[REDACTED_TOKEN]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[REDACTED_JWT]")
    .replace(/([a-z][a-z0-9+.-]*:\/\/[^\s:/]+:)[^@\s]+@/gi, "$1[REDACTED]@");

  if (sanitized.length <= MAX_REPORTED_CHARACTERS) return sanitized;
  const half = Math.floor(MAX_REPORTED_CHARACTERS / 2);
  return `${sanitized.slice(0, half)}\n...[verification output truncated]...\n${sanitized.slice(-half)}`;
}

export class LocalCommandRunner implements CommandRunner {
  async run(spec: CommandSpec, cwd: string): Promise<CommandResult> {
    const startedAt = Date.now();
    return new Promise((resolve, reject) => {
      const child = spawn(spec.command, spec.args, {
        cwd,
        env: verificationEnvironment(spec),
        shell: false,
        stdio: ["ignore", "pipe", "pipe"]
      });
      let output = "";
      let captureExceeded = false;

      const append = (chunk: Buffer | string) => {
        if (captureExceeded) return;
        output += chunk.toString();
        if (Buffer.byteLength(output) > MAX_CAPTURE_BYTES) {
          captureExceeded = true;
          output = `${output.slice(0, MAX_CAPTURE_BYTES)}\n...[command output capture limited to 1 MB]...`;
        }
      };
      child.stdout.on("data", append);
      child.stderr.on("data", append);
      child.on("error", reject);
      child.on("close", (exitCode) => {
        resolve({
          ...spec,
          passed: exitCode === 0,
          exitCode,
          durationMs: Date.now() - startedAt,
          output: sanitizeCommandOutput(output)
        });
      });
    });
  }
}

export function mandatoryVerificationSpecs(baseCommit: string): CommandSpec[] {
  if (!/^[0-9a-f]{40,64}$/i.test(baseCommit)) throw new Error("Invalid workflow base commit.");
  return [
    {
      name: "diff-check",
      command: "git",
      args: ["diff", "--check", baseCommit, "--"]
    },
    { name: "typecheck", command: "npm", args: ["run", "typecheck"] },
    { name: "lint", command: "npm", args: ["run", "lint"] },
    { name: "build", command: "npm", args: ["run", "build"] },
    {
      name: "tests",
      command: "npm",
      args: ["run", "test"]
    }
  ];
}

export async function runVerification(
  runner: CommandRunner,
  repositoryRoot: string,
  baseCommit: string
): Promise<VerificationResult> {
  const commands: CommandResult[] = [];
  for (const spec of mandatoryVerificationSpecs(baseCommit)) {
    commands.push(await runner.run(spec, repositoryRoot));
  }
  return {
    passed: commands.every((command) => command.passed),
    commands
  };
}
