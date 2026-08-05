import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";

export type ModelConfiguration = {
  plannerModel: string;
  builderModel: string;
  reviewerModel: string;
};

export const DEFAULT_MODEL_CONFIG_FILE = "tmp/ai-workflow/models.json";

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
  const allowed = new Set(["plannerModel", "builderModel", "reviewerModel"]);
  const unexpected = Object.keys(record).filter((key) => !allowed.has(key));
  if (unexpected.length > 0) {
    throw new Error(`Model configuration contains unsupported fields: ${unexpected.join(", ")}.`);
  }
  return {
    plannerModel: validateModelId(record.plannerModel, "Planner"),
    builderModel: validateModelId(record.builderModel, "Builder"),
    reviewerModel: validateModelId(record.reviewerModel, "Reviewer")
  };
}

export async function loadModelConfiguration(input: {
  repositoryRoot: string;
  configFile?: string;
  plannerModel?: string;
  builderModel?: string;
  reviewerModel?: string;
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
  let contents: string;
  try {
    contents = await readFile(path, "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      throw new Error(
        `Model configuration was not found at ${path}. Run npm run ai-workflow:models, then npm run ai-workflow:configure -- with the selected IDs.`
      );
    }
    throw error;
  }
  return parseModelConfiguration(JSON.parse(contents) as unknown);
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
