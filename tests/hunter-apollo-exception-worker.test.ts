import { spawnSync } from "node:child_process";
import path from "node:path";

import { describe, expect, it } from "vitest";

const scriptPath = path.join(
  process.cwd(),
  "ops/openclaw/hunter/hunter_apollo_exception_resolution.py"
);

describe("Hunter Apollo-exception worker", () => {
  it("deduplicates Brave evidence and completes the exact claimed run", () => {
    const source = [
      "import importlib.util, json, pathlib, sys",
      "script = pathlib.Path(sys.argv[1])",
      "sys.path.insert(0, str(script.parent))",
      "spec = importlib.util.spec_from_file_location('apollo_worker', script)",
      "module = importlib.util.module_from_spec(spec)",
      "spec.loader.exec_module(module)",
      "calls = []",
      "def api(base, token, method, route, body=None):",
      "  calls.append({'route': route, 'body': body})",
      "  if route.endswith('/prepare'):",
      "    return {'data': {'state': 'prepared', 'runId': 'run-1', 'queries': ['query one', 'query two'], 'limits': {'publicQueries': 2, 'publicEvidence': 3}}}",
      "  if route.endswith('/complete'):",
      "    return {'data': {'state': 'HUMAN_REVIEW_REQUIRED', 'evidenceCount': len(body['publicEvidence'])}}",
      "  raise RuntimeError('unexpected route')",
      "def brave(query, key, limit):",
      "  return [",
      "    {'url': 'https://example.com/about?ref=' + query.replace(' ', '-'), 'title': 'Example', 'snippet': 'Official company evidence'},",
      "    {'url': 'https://example.com/about', 'title': 'Duplicate', 'snippet': 'Duplicate evidence'},",
      "  ]",
      "module.api_request = api",
      "module.search_brave = brave",
      "module.required_env = lambda name: 'brave-key'",
      "result = module.run_apollo_exception_resolution('https://newl.example', 'token')",
      "print(json.dumps({'result': result, 'calls': calls}))"
    ].join("\n");
    const result = spawnSync("python3", ["-c", source, scriptPath], {
      encoding: "utf8",
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" }
    });
    expect(result.status, result.stderr).toBe(0);
    const payload = JSON.parse(result.stdout) as {
      result: { state: string; evidenceCount: number };
      calls: Array<{ route: string; body?: { runId: string; publicEvidence: unknown[] } }>;
    };
    expect(payload.result).toEqual({
      state: "HUMAN_REVIEW_REQUIRED",
      evidenceCount: 1
    });
    expect(payload.calls.at(-1)).toMatchObject({
      route: "/api/lead-gen/hunter/apollo-exceptions/complete",
      body: { runId: "run-1" }
    });
  });
});
