import { spawnSync } from "node:child_process";
import path from "node:path";

import { describe, expect, it } from "vitest";

const adapterPath = path.join(process.cwd(), "ops/openclaw/hunter/hunter_ingest.py");

describe("Hunter ingestion adapter", () => {
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
});
