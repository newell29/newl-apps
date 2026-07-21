import crypto from "node:crypto";

export class TeamshipBrowserWorkerAuthError extends Error {
  status: number;

  constructor(message: string, status = 401) {
    super(message);
    this.name = "TeamshipBrowserWorkerAuthError";
    this.status = status;
  }
}

export function authenticateTeamshipBrowserWorkerRequest(request: Request) {
  const expectedToken = process.env.TEAMSHIP_BROWSER_WORKER_TOKEN?.trim();
  const tenantSlug = process.env.TEAMSHIP_BROWSER_WORKER_TENANT_SLUG?.trim();
  if (!expectedToken) {
    throw new TeamshipBrowserWorkerAuthError("Teamship browser worker authentication is not configured.", 503);
  }
  if (!tenantSlug) {
    throw new TeamshipBrowserWorkerAuthError("Teamship browser worker tenant scope is not configured.", 503);
  }

  const providedToken = getBearerToken(request);
  if (!providedToken || !safeTokenEquals(providedToken, expectedToken)) {
    throw new TeamshipBrowserWorkerAuthError("Invalid Teamship browser worker credentials.");
  }

  const workerId = request.headers.get("x-teamship-browser-worker-id")?.trim() || "mac-mini-worker";
  if (!/^[a-zA-Z0-9._:-]{3,80}$/.test(workerId)) {
    throw new TeamshipBrowserWorkerAuthError("x-teamship-browser-worker-id is invalid.", 400);
  }

  return { workerId, tenantSlug };
}

function getBearerToken(request: Request) {
  const authorization = request.headers.get("authorization");
  if (!authorization) return null;
  const [scheme, token] = authorization.split(" ");
  return scheme?.toLowerCase() === "bearer" && token ? token.trim() : null;
}

function safeTokenEquals(providedToken: string, expectedToken: string) {
  const provided = Buffer.from(providedToken);
  const expected = Buffer.from(expectedToken);
  return provided.length === expected.length && crypto.timingSafeEqual(provided, expected);
}
