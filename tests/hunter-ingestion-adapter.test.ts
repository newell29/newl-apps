import { spawnSync } from "node:child_process";
import path from "node:path";

import { describe, expect, it } from "vitest";

const adapterPath = path.join(process.cwd(), "ops/openclaw/hunter/hunter_ingest.py");

describe("Hunter ingestion adapter", () => {
  it("sends the configured Vercel automation bypass without exposing it in payloads", () => {
    const python = [
      "import importlib.util, json, os, sys",
      "spec = importlib.util.spec_from_file_location('hunter_ingest', sys.argv[1])",
      "module = importlib.util.module_from_spec(spec)",
      "spec.loader.exec_module(module)",
      "os.environ['VERCEL_AUTOMATION_BYPASS_SECRET'] = 'preview-secret'",
      "headers = module.api_headers('ingestion-token')",
      "print(json.dumps({'bypass': headers.get('x-vercel-protection-bypass'), 'authorization': headers.get('Authorization')}))",
    ].join("\n");

    const result = spawnSync("python3", ["-c", python, adapterPath], {
      encoding: "utf8",
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
    });

    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      bypass: "preview-secret",
      authorization: "Bearer ingestion-token",
    });
  });

  it("quarantines canonical rows that have no company identity", () => {
    const python = [
      "import importlib.util, json, sys",
      "spec = importlib.util.spec_from_file_location('hunter_ingest', sys.argv[1])",
      "module = importlib.util.module_from_spec(spec)",
      "spec.loader.exec_module(module)",
      "rows = [",
      "  {'importer_name': 'Importer A', 'raw_json': '{}'},",
      "  {'consignee_name': '', 'shipper_name': '', 'raw_json': '{}'},",
      "]",
      "records, rejected = module.prepare_records(rows, 'Charlotte')",
      "print(json.dumps({'accepted': len(records), 'rejected': rejected}))",
    ].join("\n");

    const result = spawnSync("python3", ["-c", python, adapterPath], {
      encoding: "utf8",
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
    });

    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ accepted: 1, rejected: 1 });
  });

  it("completes an existing job successfully when a valid search returns zero rows", () => {
    const python = [
      "import importlib.util, json, os, pathlib, sys, tempfile",
      "spec = importlib.util.spec_from_file_location('hunter_ingest', sys.argv[1])",
      "module = importlib.util.module_from_spec(spec)",
      "spec.loader.exec_module(module)",
      "calls = []",
      "module.api_request = lambda base, token, method, path, payload=None: calls.append({'method': method, 'path': path, 'payload': payload}) or {}",
      "os.environ['NEWL_APPS_BASE_URL'] = 'http://localhost:3000'",
      "os.environ['INGESTION_API_TOKEN'] = 'local-test-token'",
      "with tempfile.TemporaryDirectory() as directory:",
      "  csv_path = pathlib.Path(directory) / 'empty.csv'",
      "  csv_path.write_text('')",
      "  sys.argv = ['hunter_ingest.py', '--profile-id', 'profile-1', '--job-run-id', 'job-1', '--canonical-csv', str(csv_path)]",
      "  status = module.main()",
      "print(json.dumps({'status': status, 'calls': calls}))",
    ].join("\n");

    const result = spawnSync("python3", ["-c", python, adapterPath], {
      encoding: "utf8",
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
    });

    expect(result.status, result.stderr).toBe(0);
    const parsed = JSON.parse(result.stdout.trim().split("\n").at(-1) ?? "{}");
    expect(parsed.status).toBe(0);
    expect(parsed.calls).toEqual([
      expect.objectContaining({
        method: "PATCH",
        path: "/api/integrations/trademining/job-runs/job-1",
        payload: expect.objectContaining({ status: "COMPLETED", recordsProcessed: 0 }),
      }),
    ]);
  });
});
