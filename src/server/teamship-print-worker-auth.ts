import crypto from "node:crypto";

export class TeamshipPrintWorkerAuthError extends Error {
  status: number;

  constructor(message: string, status = 401) {
    super(message);
    this.name = "TeamshipPrintWorkerAuthError";
    this.status = status;
  }
}

export function authenticateTeamshipPrintWorkerRequest(request: Request) {
  const expectedToken = process.env.TEAMSHIP_PRINT_WORKER_TOKEN?.trim();
  const tenantSlug = process.env.TEAMSHIP_PRINT_WORKER_TENANT_SLUG?.trim();
  if (!expectedToken) throw new TeamshipPrintWorkerAuthError("Teamship print worker authentication is not configured.", 503);
  if (!tenantSlug) throw new TeamshipPrintWorkerAuthError("Teamship print worker tenant scope is not configured.", 503);
  const authorization = request.headers.get("authorization");
  const [scheme, token] = authorization?.split(" ") ?? [];
  if (scheme?.toLowerCase() !== "bearer" || !token || !safeTokenEquals(token.trim(), expectedToken)) {
    throw new TeamshipPrintWorkerAuthError("Invalid Teamship print worker credentials.");
  }
  const workerId = request.headers.get("x-teamship-print-worker-id")?.trim() || "mac-mini-teamship-print";
  if (!/^[a-zA-Z0-9._:-]{3,80}$/.test(workerId)) {
    throw new TeamshipPrintWorkerAuthError("x-teamship-print-worker-id is invalid.", 400);
  }
  return { workerId, tenantSlug };
}

function safeTokenEquals(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
