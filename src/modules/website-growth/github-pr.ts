import { Buffer } from "node:buffer";

import type { WebsiteGrowthBuildPackage } from "@/modules/website-growth/build-package";

type GitHubFetch = typeof fetch;

export type WebsiteGrowthPullRequestResult = {
  status: "PR_OPENED" | "PR_UPDATED";
  pullRequestUrl: string;
  pullRequestNumber: number;
  branchName: string;
  repo: string;
  files: string[];
  createdAt: string;
};

type CreatePullRequestInput = {
  buildPackage: WebsiteGrowthBuildPackage;
  fetcher?: GitHubFetch;
  env?: Record<string, string | undefined>;
};

type GitHubRefResponse = {
  object?: {
    sha?: string;
  };
};

type GitHubContentResponse = {
  sha?: string;
};

type GitHubPullResponse = {
  number?: number;
  html_url?: string;
};

export function getWebsiteGrowthGitHubPrStatus(env: Record<string, string | undefined> = process.env) {
  const missing = [
    env.WEBSITE_GROWTH_GITHUB_TOKEN || env.GITHUB_TOKEN ? null : "WEBSITE_GROWTH_GITHUB_TOKEN",
    env.NEWL_WEBSITE_GITHUB_REPO ? null : "NEWL_WEBSITE_GITHUB_REPO"
  ].filter((value): value is string => Boolean(value));

  return {
    configured: missing.length === 0,
    missing,
    repo: env.NEWL_WEBSITE_GITHUB_REPO || null,
    baseBranch: env.NEWL_WEBSITE_BASE_BRANCH || "main"
  };
}

export async function createWebsiteGrowthPullRequestPackage({
  buildPackage,
  env = process.env,
  fetcher = fetch
}: CreatePullRequestInput): Promise<WebsiteGrowthPullRequestResult> {
  const status = getWebsiteGrowthGitHubPrStatus(env);

  if (!status.configured) {
    throw new Error(`Website Growth GitHub PR creation is not configured. Missing: ${status.missing.join(", ")}`);
  }

  const repo = parseRepoSlug(status.repo ?? "");
  const token = env.WEBSITE_GROWTH_GITHUB_TOKEN || env.GITHUB_TOKEN || "";
  const baseBranch = status.baseBranch;
  const branchName = buildPackage.branchName;
  const packageSlug = slugify(buildPackage.routePath) || slugify(buildPackage.title) || buildPackage.sourceDraftId;
  const jsonPath = `.website-growth/build-packages/${packageSlug}.json`;
  const markdownPath = `.website-growth/build-packages/${packageSlug}.md`;
  const files = [jsonPath, markdownPath];
  const request = createGitHubRequester(fetcher, token);

  const baseRef = await request<GitHubRefResponse>(
    `/repos/${repo.owner}/${repo.name}/git/ref/heads/${encodeURIComponent(baseBranch)}`
  );
  const baseSha = baseRef.object?.sha;

  if (!baseSha) {
    throw new Error(`Could not find base branch ${baseBranch} in ${status.repo}.`);
  }

  await ensureBranch({
    branchName,
    baseSha,
    repo,
    request
  });

  await upsertFile({
    branchName,
    content: JSON.stringify(buildPackage, null, 2),
    message: `Add Website Growth package for ${buildPackage.routePath}`,
    path: jsonPath,
    repo,
    request
  });

  await upsertFile({
    branchName,
    content: buildPullRequestMarkdown(buildPackage),
    message: `Add Website Growth review notes for ${buildPackage.routePath}`,
    path: markdownPath,
    repo,
    request
  });

  const existingPullRequest = await findExistingPullRequest({
    branchName,
    repo,
    request
  });

  if (existingPullRequest.html_url && existingPullRequest.number) {
    return {
      status: "PR_UPDATED",
      pullRequestUrl: existingPullRequest.html_url,
      pullRequestNumber: existingPullRequest.number,
      branchName,
      repo: `${repo.owner}/${repo.name}`,
      files,
      createdAt: new Date().toISOString()
    };
  }

  const pullRequest = await request<GitHubPullResponse>(`/repos/${repo.owner}/${repo.name}/pulls`, {
    method: "POST",
    body: JSON.stringify({
      title: `Website Growth: ${buildPackage.title}`,
      head: branchName,
      base: baseBranch,
      body: buildPullRequestBody(buildPackage, files)
    })
  });

  if (!pullRequest.html_url || !pullRequest.number) {
    throw new Error("GitHub created an unexpected pull request response.");
  }

  return {
    status: "PR_OPENED",
    pullRequestUrl: pullRequest.html_url,
    pullRequestNumber: pullRequest.number,
    branchName,
    repo: `${repo.owner}/${repo.name}`,
    files,
    createdAt: new Date().toISOString()
  };
}

function createGitHubRequester(fetcher: GitHubFetch, token: string) {
  return async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);

    headers.set("Accept", "application/vnd.github+json");
    headers.set("Authorization", `Bearer ${token}`);
    headers.set("Content-Type", "application/json");
    headers.set("X-GitHub-Api-Version", "2022-11-28");

    const response = await fetcher(`https://api.github.com${path}`, {
      ...init,
      headers
    });

    if (!response.ok) {
      const body = await response.text();
      throw new GitHubRequestError(response.status, body);
    }

    if (response.status === 204) {
      return {} as T;
    }

    return await response.json() as T;
  };
}

async function ensureBranch({
  baseSha,
  branchName,
  repo,
  request
}: {
  baseSha: string;
  branchName: string;
  repo: { owner: string; name: string };
  request: ReturnType<typeof createGitHubRequester>;
}) {
  try {
    await request(`/repos/${repo.owner}/${repo.name}/git/refs`, {
      method: "POST",
      body: JSON.stringify({
        ref: `refs/heads/${branchName}`,
        sha: baseSha
      })
    });
  } catch (error) {
    if (error instanceof GitHubRequestError && error.status === 422) {
      return;
    }

    throw error;
  }
}

async function upsertFile({
  branchName,
  content,
  message,
  path,
  repo,
  request
}: {
  branchName: string;
  content: string;
  message: string;
  path: string;
  repo: { owner: string; name: string };
  request: ReturnType<typeof createGitHubRequester>;
}) {
  const existing = await readExistingContentSha({ branchName, path, repo, request });

  await request(`/repos/${repo.owner}/${repo.name}/contents/${encodePath(path)}`, {
    method: "PUT",
    body: JSON.stringify({
      branch: branchName,
      message,
      content: Buffer.from(content, "utf8").toString("base64"),
      sha: existing?.sha
    })
  });
}

async function readExistingContentSha({
  branchName,
  path,
  repo,
  request
}: {
  branchName: string;
  path: string;
  repo: { owner: string; name: string };
  request: ReturnType<typeof createGitHubRequester>;
}) {
  try {
    return await request<GitHubContentResponse>(
      `/repos/${repo.owner}/${repo.name}/contents/${encodePath(path)}?ref=${encodeURIComponent(branchName)}`
    );
  } catch (error) {
    if (error instanceof GitHubRequestError && error.status === 404) {
      return null;
    }

    throw error;
  }
}

async function findExistingPullRequest({
  branchName,
  repo,
  request
}: {
  branchName: string;
  repo: { owner: string; name: string };
  request: ReturnType<typeof createGitHubRequester>;
}) {
  const pulls = await request<GitHubPullResponse[]>(
    `/repos/${repo.owner}/${repo.name}/pulls?state=open&head=${encodeURIComponent(`${repo.owner}:${branchName}`)}`
  );

  return pulls[0] ?? {};
}

function buildPullRequestMarkdown(buildPackage: WebsiteGrowthBuildPackage) {
  const sections = buildPackage.implementation.sections
    .map((section) => `## ${section.heading}\n\n**Purpose:** ${section.purpose}\n\n${section.draftCopy}`)
    .join("\n\n");
  const faqs = buildPackage.implementation.faqs
    .map((faq) => `- **${faq.question}** ${faq.answer}`)
    .join("\n");
  const links = buildPackage.implementation.internalLinks
    .map((link) => `- [${link.label}](${link.url}) — ${link.reason}`)
    .join("\n");

  return `# ${buildPackage.title}

Route: \`${buildPackage.routePath}\`

Mode: \`${buildPackage.mode}\`

Target keyword: ${buildPackage.metadata.targetKeyword}

Meta title: ${buildPackage.metadata.metaTitle}

Meta description: ${buildPackage.metadata.metaDescription}

## Implementation Notes

${buildPackage.implementation.routeAction}

${buildPackage.implementation.filePlan.map((item) => `- ${item}`).join("\n")}

${sections}

## FAQs

${faqs || "No FAQs proposed."}

## Internal Links

${links || "No internal links proposed."}

## Checklist

${buildPackage.implementation.checklist.map((item) => `- [ ] ${item}`).join("\n")}
`;
}

function buildPullRequestBody(buildPackage: WebsiteGrowthBuildPackage, files: string[]) {
  return `## Website Growth review package

This PR was generated from Newl Apps Website Growth approval.

**Route:** \`${buildPackage.routePath}\`
**Mode:** \`${buildPackage.mode}\`
**Draft ID:** \`${buildPackage.sourceDraftId}\`
**Opportunity ID:** \`${buildPackage.sourceOpportunityId}\`

### Files
${files.map((file) => `- \`${file}\``).join("\n")}

### Review flow
${buildPackage.approvalFlow.map((step) => `- ${step}`).join("\n")}

This PR is a review handoff package. It should be turned into the final website route/component change before merge.`;
}

function parseRepoSlug(value: string) {
  const [owner, name] = value.split("/");

  if (!owner || !name) {
    throw new Error("NEWL_WEBSITE_GITHUB_REPO must be in owner/repo format.");
  }

  return { owner, name };
}

function encodePath(path: string) {
  return path.split("/").map(encodeURIComponent).join("/");
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);
}

class GitHubRequestError extends Error {
  constructor(public readonly status: number, body: string) {
    super(`GitHub API request failed (${status}): ${body}`);
  }
}
