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

  it("marks capped unsplittable retrieval as partial and sends coverage metrics", () => {
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
      "  root = pathlib.Path(directory)",
      "  csv_path = root / 'empty.csv'",
      "  csv_path.write_text('')",
      "  coverage_path = root / 'manifest.json'",
      "  coverage_path.write_text(json.dumps({'coverage': {'matched_records': 25000, 'exported_records': 25000, 'query_count': 1, 'exported_query_count': 1, 'split_query_count': 0, 'retrieval_complete': False, 'max_export_rows': 25000}}))",
      "  sys.argv = ['hunter_ingest.py', '--profile-id', 'profile-1', '--job-run-id', 'job-1', '--canonical-csv', str(csv_path), '--coverage-manifest', str(coverage_path)]",
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
        payload: expect.objectContaining({
          status: "PARTIAL",
          metadata: expect.objectContaining({
            coverage: {
              matchedRecords: 25000,
              exportedRecords: 25000,
              queryCount: 1,
              exportedQueryCount: 1,
              splitQueryCount: 0,
              retrievalComplete: false,
              maxExportRows: 25000,
            },
          }),
        }),
      }),
    ]);
  });

  it("retries transient Newl Apps failures with bounded backoff", () => {
    const python = [
      "import importlib.util, json, sys",
      "spec = importlib.util.spec_from_file_location('hunter_ingest', sys.argv[1])",
      "module = importlib.util.module_from_spec(spec)",
      "spec.loader.exec_module(module)",
      "attempts = []",
      "sleeps = []",
      "def request(*_args, **_kwargs):",
      "  attempts.append(len(attempts) + 1)",
      "  if len(attempts) < 3: raise module.NewlAppsRequestError('pool exhausted', status=500)",
      "  return {'data': {'ok': True}}",
      "module.api_request = request",
      "module.time.sleep = lambda seconds: sleeps.append(seconds)",
      "result = module.ingestion_api_request('https://example.com', 'token', 'POST', '/batches', {})",
      "print(json.dumps({'attempts': attempts, 'sleeps': sleeps, 'result': result}))",
    ].join("\n");

    const result = spawnSync("python3", ["-c", python, adapterPath], {
      encoding: "utf8",
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
    });

    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      attempts: [1, 2, 3],
      sleeps: [2, 5],
      result: { data: { ok: true } },
    });
  });

  it("does not retry permanent Newl Apps request failures", () => {
    const python = [
      "import importlib.util, json, sys",
      "spec = importlib.util.spec_from_file_location('hunter_ingest', sys.argv[1])",
      "module = importlib.util.module_from_spec(spec)",
      "spec.loader.exec_module(module)",
      "attempts = []",
      "sleeps = []",
      "def request(*_args, **_kwargs):",
      "  attempts.append(len(attempts) + 1)",
      "  raise module.NewlAppsRequestError('invalid profile', status=400)",
      "module.api_request = request",
      "module.time.sleep = lambda seconds: sleeps.append(seconds)",
      "try:",
      "  module.ingestion_api_request('https://example.com', 'token', 'POST', '/batches', {})",
      "except module.NewlAppsRequestError as error:",
      "  message = str(error)",
      "else:",
      "  raise RuntimeError('permanent failure unexpectedly succeeded')",
      "print(json.dumps({'attempts': attempts, 'sleeps': sleeps, 'message': message}))",
    ].join("\n");

    const result = spawnSync("python3", ["-c", python, adapterPath], {
      encoding: "utf8",
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
    });

    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      attempts: [1],
      sleeps: [],
      message: "invalid profile",
    });
  });

  it("fails closed when a checkpoint belongs to a different canonical export", () => {
    const python = [
      "import importlib.util, json, pathlib, sys, tempfile",
      "spec = importlib.util.spec_from_file_location('hunter_ingest', sys.argv[1])",
      "module = importlib.util.module_from_spec(spec)",
      "spec.loader.exec_module(module)",
      "with tempfile.TemporaryDirectory() as directory:",
      "  path = pathlib.Path(directory) / 'checkpoint.json'",
      "  module.write_checkpoint(path, {'version': 1, 'jobRunId': 'job-1', 'profileId': 'profile-1', 'sourceFingerprint': 'old', 'batchSize': 250, 'totalRecords': 10, 'totalBatches': 1, 'nextBatchIndex': 0, 'recordsProcessed': 0, 'recordsCreated': 0, 'recordsUpdated': 0, 'recordsSkipped': 0, 'completed': False})",
      "  try:",
      "    module.read_checkpoint(path, job_run_id='job-1', profile_id='profile-1', source_fingerprint='new', batch_size=250, total_records=10, total_batches=1)",
      "  except RuntimeError as error:",
      "    message = str(error)",
      "  else:",
      "    raise RuntimeError('mismatched checkpoint unexpectedly accepted')",
      "print(json.dumps({'message': message}))",
    ].join("\n");

    const result = spawnSync("python3", ["-c", python, adapterPath], {
      encoding: "utf8",
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
    });

    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout).message).toContain("sourceFingerprint");
  });

  it("resumes from the last successful batch without replaying the canonical export", () => {
    const python = [
      "import importlib.util, json, os, pathlib, stat, sys, tempfile",
      "spec = importlib.util.spec_from_file_location('hunter_ingest', sys.argv[1])",
      "module = importlib.util.module_from_spec(spec)",
      "spec.loader.exec_module(module)",
      "os.environ['NEWL_APPS_BASE_URL'] = 'http://localhost:3000'",
      "os.environ['INGESTION_API_TOKEN'] = 'local-test-token'",
      "with tempfile.TemporaryDirectory() as directory:",
      "  root = pathlib.Path(directory)",
      "  csv_path = root / 'canonical.csv'",
      "  csv_path.write_text('importer_name,house_bol_number,raw_json\\nAlpha,A,{}\\nBeta,B,{}\\nGamma,C,{}\\n')",
      "  calls = []",
      "  state = {'batchCalls': 0, 'failed': False}",
      "  def request(_base, _token, method, path, payload=None):",
      "    calls.append({'method': method, 'path': path, 'records': len((payload or {}).get('records', []))})",
      "    if path.endswith('/batches'):",
      "      state['batchCalls'] += 1",
      "      if state['batchCalls'] == 2 and not state['failed']:",
      "        state['failed'] = True",
      "        raise RuntimeError('simulated exhausted retry budget')",
      "      count = len(payload['records'])",
      "      return {'data': {'recordsProcessed': count, 'recordsCreated': count}}",
      "    return {}",
      "  module.ingestion_api_request = request",
      "  sys.argv = ['hunter_ingest.py', '--profile-id', 'profile-1', '--job-run-id', 'job-1', '--canonical-csv', str(csv_path), '--batch-size', '2']",
      "  try:",
      "    module.main()",
      "  except RuntimeError:",
      "    pass",
      "  else:",
      "    raise RuntimeError('first ingestion unexpectedly succeeded')",
      "  checkpoint_path = module.default_checkpoint_path(csv_path, 'job-1')",
      "  first_checkpoint = json.loads(checkpoint_path.read_text())",
      "  status = module.main()",
      "  final_checkpoint = json.loads(checkpoint_path.read_text())",
      "  mode = stat.S_IMODE(checkpoint_path.stat().st_mode)",
      "print(json.dumps({'status': status, 'batchCalls': state['batchCalls'], 'first': first_checkpoint, 'final': final_checkpoint, 'mode': mode, 'calls': calls}))",
    ].join("\n");

    const result = spawnSync("python3", ["-c", python, adapterPath], {
      encoding: "utf8",
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
    });

    expect(result.status, result.stderr).toBe(0);
    const parsed = JSON.parse(result.stdout.trim().split("\n").at(-1) ?? "{}");
    expect(parsed.status).toBe(0);
    expect(parsed.batchCalls).toBe(3);
    expect(parsed.first).toMatchObject({
      nextBatchIndex: 1,
      recordsProcessed: 2,
      completed: false,
    });
    expect(parsed.final).toMatchObject({
      nextBatchIndex: 2,
      recordsProcessed: 3,
      recordsCreated: 3,
      completed: true,
    });
    expect(parsed.mode).toBe(0o600);
  });
});
