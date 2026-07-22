export type WebsiteGrowthDeveloperDispatchStatus = {
  configured: boolean;
  missing: string[];
  repository: string | null;
  baseBranch: string;
  workflowFile: string;
  model: string;
  reasoningEffort: "low" | "medium" | "high" | "xhigh";
};

type Env = Record<string, string | undefined>;

export function getWebsiteGrowthDeveloperDispatchStatus(
  env: Env = process.env
): WebsiteGrowthDeveloperDispatchStatus {
  const required = ["WEBSITE_GROWTH_GITHUB_TOKEN", "NEWL_WEBSITE_GITHUB_REPO"];
  const missing = required.filter((key) => !env[key]?.trim());

  return {
    configured: missing.length === 0,
    missing,
    repository: env.NEWL_WEBSITE_GITHUB_REPO?.trim() || null,
    baseBranch: env.NEWL_WEBSITE_BASE_BRANCH?.trim() || "main",
    workflowFile: env.WEBSITE_GROWTH_BUILD_WORKFLOW?.trim() || "website-growth-build.yml",
    model: env.WEBSITE_GROWTH_CODEX_MODEL?.trim() || "gpt-5.6-sol",
    reasoningEffort: normalizeEffort(env.WEBSITE_GROWTH_CODEX_REASONING_EFFORT)
  };
}

export async function dispatchWebsiteGrowthDeveloperBuild({
  buildRequestId,
  tenantSlug,
  env = process.env,
  fetcher = fetch
}: {
  buildRequestId: string;
  tenantSlug: string;
  env?: Env;
  fetcher?: typeof fetch;
}) {
  if (!/^[a-zA-Z0-9_-]{8,80}$/.test(buildRequestId)) {
    throw new Error("Website Growth build request ID is invalid.");
  }
  if (!/^[a-z0-9-]{2,80}$/.test(tenantSlug)) {
    throw new Error("Website Growth tenant slug is invalid.");
  }

  const status = getWebsiteGrowthDeveloperDispatchStatus(env);
  if (!status.configured || !status.repository) {
    throw new Error(`Website Growth developer dispatch is not configured. Missing: ${status.missing.join(", ")}`);
  }

  const response = await fetcher(
    `https://api.github.com/repos/${status.repository}/actions/workflows/${encodeURIComponent(status.workflowFile)}/dispatches`,
    {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${env.WEBSITE_GROWTH_GITHUB_TOKEN}`,
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28"
      },
      body: JSON.stringify({
        ref: status.baseBranch,
        inputs: {
          build_request_id: buildRequestId,
          tenant_slug: tenantSlug,
          model: status.model,
          reasoning_effort: status.reasoningEffort
        }
      })
    }
  );

  if (response.status !== 204) {
    const detail = await response.text();
    throw new Error(`Website Growth developer dispatch failed (${response.status}): ${detail}`);
  }

  return {
    status: "DISPATCHED" as const,
    repository: status.repository,
    baseBranch: status.baseBranch,
    workflowFile: status.workflowFile,
    model: status.model,
    reasoningEffort: status.reasoningEffort
  };
}

function normalizeEffort(value?: string): WebsiteGrowthDeveloperDispatchStatus["reasoningEffort"] {
  return value === "low" || value === "medium" || value === "high" || value === "xhigh" ? value : "high";
}
