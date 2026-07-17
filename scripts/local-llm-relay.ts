import http from "node:http";
import { URL } from "node:url";

const DEFAULT_RELAY_PORT = 41134;
const DEFAULT_UPSTREAM_BASE_URL = "http://127.0.0.1:11434/v1";
const REQUEST_TIMEOUT_MS = 120_000;
const ALLOWED_METHODS = new Set(["GET", "POST"]);
const ALLOWED_PATHS = new Set(["/v1/models", "/v1/chat/completions"]);

const relayToken = process.env.LOCAL_LLM_RELAY_TOKEN?.trim();
const upstreamBaseUrl = normalizeBaseUrl(
  process.env.LOCAL_LLM_RELAY_UPSTREAM_URL ?? DEFAULT_UPSTREAM_BASE_URL
);
const relayPort = readPort(process.env.LOCAL_LLM_RELAY_PORT, DEFAULT_RELAY_PORT);

if (!relayToken) {
  console.error("LOCAL_LLM_RELAY_TOKEN is required.");
  process.exit(1);
}

const server = http.createServer(async (request, response) => {
  try {
    await handleRequest(request, response);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown relay error";
    writeJson(response, 500, { error: "Relay request failed.", message });
  }
});

server.listen(relayPort, "127.0.0.1", () => {
  console.log(`Local LLM relay listening on http://127.0.0.1:${relayPort}`);
  console.log(`Forwarding allowed OpenAI-compatible requests to ${upstreamBaseUrl}`);
});

async function handleRequest(request: http.IncomingMessage, response: http.ServerResponse) {
  const method = request.method ?? "GET";
  const requestUrl = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);

  if (!ALLOWED_METHODS.has(method) || !ALLOWED_PATHS.has(requestUrl.pathname)) {
    writeJson(response, 404, { error: "Route is not exposed by this relay." });
    return;
  }

  if (!isAuthorized(request.headers.authorization)) {
    writeJson(response, 401, { error: "Missing or invalid bearer token." });
    return;
  }

  if (requestUrl.pathname === "/v1/models" && method !== "GET") {
    writeJson(response, 405, { error: "Use GET for /v1/models." });
    return;
  }

  if (requestUrl.pathname === "/v1/chat/completions" && method !== "POST") {
    writeJson(response, 405, { error: "Use POST for /v1/chat/completions." });
    return;
  }

  const body = method === "POST" ? await readRequestBody(request) : undefined;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const upstreamResponse = await fetch(`${upstreamBaseUrl}${requestUrl.pathname.replace(/^\/v1/, "")}${requestUrl.search}`, {
      method,
      headers: buildUpstreamHeaders(request),
      body,
      signal: controller.signal
    });

    response.statusCode = upstreamResponse.status;
    response.statusMessage = upstreamResponse.statusText;
    upstreamResponse.headers.forEach((value, key) => {
      if (!isHopByHopHeader(key)) {
        response.setHeader(key, value);
      }
    });

    const responseBody = Buffer.from(await upstreamResponse.arrayBuffer());
    response.end(responseBody);
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeBaseUrl(value: string) {
  return value.trim().replace(/\/+$/, "");
}

function readPort(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  if (Number.isInteger(parsed) && parsed > 0 && parsed < 65536) {
    return parsed;
  }

  return fallback;
}

function isAuthorized(authorizationHeader: string | undefined) {
  const expected = `Bearer ${relayToken}`;
  return authorizationHeader === expected;
}

function buildUpstreamHeaders(request: http.IncomingMessage) {
  const headers = new Headers();
  const contentType = request.headers["content-type"];

  if (typeof contentType === "string") {
    headers.set("content-type", contentType);
  } else {
    headers.set("content-type", "application/json");
  }

  return headers;
}

function isHopByHopHeader(headerName: string) {
  return [
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade"
  ].includes(headerName.toLowerCase());
}

async function readRequestBody(request: http.IncomingMessage) {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks);
}

function writeJson(response: http.ServerResponse, statusCode: number, body: Record<string, unknown>) {
  response.writeHead(statusCode, {
    "content-type": "application/json"
  });
  response.end(JSON.stringify(body));
}
