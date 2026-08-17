import { chromium, type Page } from "playwright-core";

import type { TeamshipRuntimeCredentials } from "@/server/integrations/teamship";

const DEFAULT_TEAMSHIP_APP_BASE_URL = "https://app.teamshipos.com";
const DEFAULT_ALLOWED_HOSTS = ["app.teamshipos.com", "staging.teamshipos.com", "dev.teamshipos.com"];

export type TmgDocumentUploadJob = {
  id: string;
  status: "APPROVED";
  customerReference: string;
  teamshipOrderId: string;
  fileName: string;
  fileBytes: Uint8Array;
  fileHash: string;
  requestHash: string;
  approvedRequestHash: string;
};

export type TmgDocumentUploadResult = {
  status: "UPLOADED" | "ALREADY_PRESENT";
  customerReference: string;
  teamshipOrderId: string;
  fileName: string;
  fileHash: string;
  verifiedAt: string;
};

export async function executeTmgTeamshipDocumentUpload({
  job,
  credentials,
  options
}: {
  job: TmgDocumentUploadJob;
  credentials: TeamshipRuntimeCredentials;
  options: {
    allowLiveUpload: boolean;
    browserExecutablePath?: string | null;
    headed?: boolean;
    slowMoMs?: number;
    allowedHosts?: string[];
  };
}): Promise<TmgDocumentUploadResult> {
  if (!options.allowLiveUpload) throw new Error("Live TMG Teamship document upload is disabled on this worker.");
  if (job.status !== "APPROVED" || job.requestHash !== job.approvedRequestHash) {
    throw new Error("The TMG document upload is not bound to the current approved request.");
  }
  if (!job.fileName.toLowerCase().endsWith(".pdf") || job.fileBytes.byteLength === 0 || job.fileBytes.byteLength > 2 * 1024 * 1024) {
    throw new Error("The approved TMG document must be a non-empty PDF no larger than 2 MB.");
  }

  const appBaseUrl = resolveAppBaseUrl(credentials.apiBaseUrl);
  const allowedHosts = options.allowedHosts ?? DEFAULT_ALLOWED_HOSTS;
  const url = new URL(`/ship-inventories/${encodeURIComponent(job.teamshipOrderId)}`, appBaseUrl);
  if (!allowedHosts.includes(url.hostname)) throw new Error("The TMG Teamship order URL host is not allowlisted.");
  const browser = await launchBrowser(options);
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
    await page.goto(url.toString(), { waitUntil: "domcontentloaded" });
    await maybeLogin(page, credentials);
    await page.goto(url.toString(), { waitUntil: "domcontentloaded" });
    await waitForIdle(page);
    await assertExactOrderReference(page, job.customerReference);

    if (await page.getByText(job.fileName, { exact: true }).isVisible().catch(() => false)) {
      return resultFor(job, "ALREADY_PRESENT");
    }

    const input = page.locator('input[type="file"]#box-labels');
    if (await input.count() !== 1) throw new Error("Expected exactly one Teamship Document upload file control.");
    await input.setInputFiles({ name: job.fileName, mimeType: "application/pdf", buffer: Buffer.from(job.fileBytes) });
    await page.getByText(job.fileName, { exact: true }).waitFor({ state: "visible", timeout: 30_000 });
    await page.reload({ waitUntil: "domcontentloaded" });
    await waitForIdle(page);
    await assertExactOrderReference(page, job.customerReference);
    if (!await page.getByText(job.fileName, { exact: true }).isVisible().catch(() => false)) {
      throw new Error("Teamship did not show the exact uploaded filename after reload. Do not retry automatically.");
    }
    return resultFor(job, "UPLOADED");
  } finally {
    await browser.close().catch(() => undefined);
  }
}

function resultFor(job: TmgDocumentUploadJob, status: TmgDocumentUploadResult["status"]): TmgDocumentUploadResult {
  return {
    status,
    customerReference: job.customerReference,
    teamshipOrderId: job.teamshipOrderId,
    fileName: job.fileName,
    fileHash: job.fileHash,
    verifiedAt: new Date().toISOString()
  };
}

async function assertExactOrderReference(page: Page, expected: string) {
  const candidates = [
    page.locator('input[name="poNumber"]'),
    page.locator('input[name="amazon_shipment_id1"]')
  ];
  const values: string[] = [];
  for (const candidate of candidates) {
    if (await candidate.count() > 0) {
      values.push(await candidate.first().getAttribute("value") ?? "");
    }
  }
  if (!values.some((value) => value.trim().toUpperCase() === expected.trim().toUpperCase())) {
    throw new Error("The exact TMG customer reference was not confirmed on the Teamship order page.");
  }
}

async function maybeLogin(page: Page, credentials: TeamshipRuntimeCredentials) {
  const email = page.locator('input[type="email"], input[name="email"], input#email').first();
  const password = page.locator('input[type="password"], input[name="password"], input#password').first();
  if (await email.count() === 0 || await password.count() === 0) return;
  await email.fill(credentials.email);
  await password.fill(credentials.password);
  await page.getByRole("button", { name: /log in|login|sign in|submit/i }).first().click();
  await waitForIdle(page);
}

async function launchBrowser(options: {
  browserExecutablePath?: string | null;
  headed?: boolean;
  slowMoMs?: number;
}) {
  const executablePath = options.browserExecutablePath?.trim() || process.env.TEAMSHIP_BROWSER_EXECUTABLE_PATH?.trim();
  if (!executablePath) throw new Error("Set TEAMSHIP_BROWSER_EXECUTABLE_PATH for the TMG document-upload worker.");
  return chromium.launch({
    executablePath,
    headless: !options.headed,
    slowMo: options.slowMoMs && options.slowMoMs > 0 ? options.slowMoMs : undefined
  });
}

async function waitForIdle(page: Page) {
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(300);
}

function resolveAppBaseUrl(apiBaseUrl: string | null | undefined) {
  const configured = apiBaseUrl?.trim().replace(/\/$/, "");
  if (!configured) return DEFAULT_TEAMSHIP_APP_BASE_URL;
  return configured.replace(/\/api$/, "");
}
