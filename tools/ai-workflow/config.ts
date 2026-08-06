import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, relative, resolve, sep } from "node:path";

export type ModelConfiguration = {
  plannerModel: string;
  builderModel: string;
  reviewerModel: string;
  escalationModel?: string;
};

export const DEFAULT_MODEL_CONFIG_FILE = "tmp/ai-workflow/models.json";
export const DEFAULT_USER_MODEL_CONFIG_FILE = resolve(
  process.env.XDG_CONFIG_HOME ?? resolve(homedir(), ".config"),
  "newl-ai-workflow",
  "models.json"
);

export function validateModelId(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`${label} model is required in provider/model form.`);
  }
  const normalized = value.trim();
  if (
    !normalized ||
    normalized.length > 200 ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(normalized)
  ) {
    throw new Error(`${label} model must be a safe OpenCode provider/model ID.`);
  }
  return normalized;
}

function modelConfigPath(repositoryRoot: string, configuredPath?: string): string {
  const path = resolve(repositoryRoot, configuredPath ?? DEFAULT_MODEL_CONFIG_FILE);
  const rel = relative(repositoryRoot, path);
  if (!rel.startsWith(`tmp${sep}`) || rel.includes(`..${sep}`)) {
    throw new Error("Model configuration must remain under the repository's ignored tmp/ directory.");
  }
  return path;
}

function parseModelConfiguration(value: unknown): ModelConfiguration {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Model configuration must be a JSON object.");
  }
  const record = value as Record<string, unknown>;
  const allowed = new Set(["plannerModel", "builderModel", "reviewerModel", "escalationModel"]);
  const unexpected = Object.keys(record).filter((key) => !allowed.has(key));
  if (unexpected.length > 0) {
    throw new Error(`Model configuration contains unsupported fields: ${unexpected.join(", ")}.`);
  }
  const configuration: ModelConfiguration = {
    plannerModel: validateModelId(record.plannerModel, "Planner"),
    builderModel: validateModelId(record.builderModel, "Builder"),
    reviewerModel: validateModelId(record.reviewerModel, "Reviewer")
  };
  if (record.escalationModel !== undefined && record.escalationModel !== null) {
    configuration.escalationModel = validateModelId(record.escalationModel, "Escalation");
  }
  return configuration;
}

async function readConfigurationIfPresent(path: string): Promise<ModelConfiguration | null> {
  try {
    return parseModelConfiguration(JSON.parse(await readFile(path, "utf8")) as unknown);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function loadModelConfiguration(input: {
  repositoryRoot: string;
  configFile?: string;
  plannerModel?: string;
  builderModel?: string;
  reviewerModel?: string;
  userConfigFile?: string;
}): Promise<ModelConfiguration> {
  const explicit = input.plannerModel || input.builderModel || input.reviewerModel;
  if (explicit) {
    return {
      plannerModel: validateModelId(
        input.plannerModel ?? process.env.AI_WORKFLOW_PLANNER_MODEL,
        "Planner"
      ),
      builderModel: validateModelId(
        input.builderModel ?? process.env.AI_WORKFLOW_BUILDER_MODEL,
        "Builder"
      ),
      reviewerModel: validateModelId(
        input.reviewerModel ?? process.env.AI_WORKFLOW_REVIEWER_MODEL,
        "Reviewer"
      )
    };
  }

  const environmentModels = {
    plannerModel: process.env.AI_WORKFLOW_PLANNER_MODEL,
    builderModel: process.env.AI_WORKFLOW_BUILDER_MODEL,
    reviewerModel: process.env.AI_WORKFLOW_REVIEWER_MODEL
  };
  if (environmentModels.plannerModel || environmentModels.builderModel || environmentModels.reviewerModel) {
    return parseModelConfiguration(environmentModels);
  }

  const path = modelConfigPath(input.repositoryRoot, input.configFile);
  const worktreeConfiguration = await readConfigurationIfPresent(path);
  if (worktreeConfiguration) return worktreeConfiguration;

  const userPath = resolve(input.userConfigFile ?? DEFAULT_USER_MODEL_CONFIG_FILE);
  const userConfiguration = await readConfigurationIfPresent(userPath);
  if (userConfiguration) return userConfiguration;
  throw new Error(
    `No model defaults were found at ${path} or ${userPath}. Run npm run ai:feature -- models configure.`
  );
}

export async function saveModelConfiguration(
  repositoryRoot: string,
  configuration: ModelConfiguration,
  configuredPath?: string
): Promise<string> {
  const path = modelConfigPath(repositoryRoot, configuredPath);
  const validated = parseModelConfiguration(configuration);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(validated, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await chmod(path, 0o600);
  return path;
}

export async function saveUserModelConfiguration(
  configuration: ModelConfiguration,
  configuredPath = DEFAULT_USER_MODEL_CONFIG_FILE
): Promise<string> {
  const path = resolve(configuredPath);
  const validated = parseModelConfiguration(configuration);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await chmod(dirname(path), 0o700);
  await writeFile(path, `${JSON.stringify(validated, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600
  });
  await chmod(path, 0o600);
  return path;
}
