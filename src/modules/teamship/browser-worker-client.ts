export type TeamshipBrowserWorkerRequestIdentity = {
  token: string;
  workerId: string;
  vercelProtectionBypass: string | null;
};

export function buildTeamshipBrowserWorkerHeaders(
  identity: TeamshipBrowserWorkerRequestIdentity
): Record<string, string> {
  const headers: Record<string, string> = {
    authorization: `Bearer ${identity.token}`,
    "content-type": "application/json",
    "x-teamship-browser-worker-id": identity.workerId
  };

  if (identity.vercelProtectionBypass) {
    headers["x-vercel-protection-bypass"] = identity.vercelProtectionBypass;
  }

  return headers;
}

export function isTransientTeamshipBrowserWorkerClaimStatus(status: number) {
  return status === 502 || status === 503 || status === 504;
}
