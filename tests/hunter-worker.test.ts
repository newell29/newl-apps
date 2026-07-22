import { spawnSync } from "node:child_process";
import path from "node:path";

import { describe, expect, it } from "vitest";

const workerPath = path.join(process.cwd(), "ops/openclaw/hunter/hunter_worker.py");

function runWorkerProbe(source: string) {
  return spawnSync("python3", ["-c", source, workerPath], {
    encoding: "utf8",
    env: {
      ...process.env,
      PYTHONDONTWRITEBYTECODE: "1",
      HUNTER_COLLECTION_DAYS: "1",
      HUNTER_DAILY_RUN_TIME: "07:00",
      HUNTER_TRADEMINING_PORTS_JSON: JSON.stringify({
        "Charleston, South Carolina": "1237"
      })
    }
  });
}

describe("Hunter daily profile worker", () => {
  it("plans the profile's full lookback and ignores the retired global collection cap", () => {
    const python = [
      "import importlib.util, json, pathlib, sys",
      "worker_path = pathlib.Path(sys.argv[1])",
      "sys.path.insert(0, str(worker_path.parent))",
      "spec = importlib.util.spec_from_file_location('hunter_worker', worker_path)",
      "module = importlib.util.module_from_spec(spec)",
      "spec.loader.exec_module(module)",
      "profile = {",
      "  'id': 'profile-charlotte',",
      "  'name': 'Charlotte Warehouse Leads',",
      "  'destinationPorts': ['Charleston, South Carolina'],",
      "  'lookbackDays': 120,",
      "  'schedule': {'timezone': 'America/Toronto', 'metadata': {}},",
      "  'lastRunAt': None,",
      "}",
      "plan = module.build_profile_plan(profile)",
      "print(json.dumps({'lookbackDays': plan['lookbackDays'], 'queryCount': plan['queryCount']}))"
    ].join("\n");

    const result = runWorkerProbe(python);

    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ lookbackDays: 120, queryCount: 1 });
  });

  it("plans every source filter in one TradeMining query", () => {
    const python = [
      "import importlib.util, json, pathlib, sys",
      "worker_path = pathlib.Path(sys.argv[1])",
      "sys.path.insert(0, str(worker_path.parent))",
      "spec = importlib.util.spec_from_file_location('hunter_worker', worker_path)",
      "module = importlib.util.module_from_spec(spec)",
      "spec.loader.exec_module(module)",
      "profile = {",
      "  'id': 'profile-charlotte',",
      "  'name': 'Charlotte Warehouse Leads',",
      "  'destinationPorts': ['Charleston, South Carolina'],",
      "  'originCountries': ['Vietnam', 'Thailand'],",
      "  'originPorts': ['Ho Chi Minh City', 'Laem Chabang'],",
      "  'shipFromPorts': ['Ho Chi Minh', 'Busan'],",
      "  'productKeywords': ['consumer goods', 'fixtures'],",
      "  'hsCodes': ['6109', '9403'],",
      "  'minShipmentVolume': '10',",
      "  'lookbackDays': 120,",
      "  'schedule': {'timezone': 'America/Toronto', 'metadata': {}},",
      "  'lastRunAt': None,",
      "}",
      "plan = module.build_profile_plan(profile)",
      "print(json.dumps(plan))"
    ].join("\n");

    const result = runWorkerProbe(python);

    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      queryCount: 1,
      lookbackDays: 120,
      originCountries: ["Vietnam", "Thailand"],
      originPorts: ["Ho Chi Minh City", "Laem Chabang"],
      shipFromPorts: ["Ho Chi Minh", "Busan"],
      productKeywords: ["consumer goods", "fixtures"],
      hsCodes: ["6109", "9403"],
      minimumTeu: 10
    });
  });

  it("runs each enabled profile at most once per local day after the daily time", () => {
    const python = [
      "import datetime as dt, importlib.util, json, pathlib, sys",
      "worker_path = pathlib.Path(sys.argv[1])",
      "sys.path.insert(0, str(worker_path.parent))",
      "spec = importlib.util.spec_from_file_location('hunter_worker', worker_path)",
      "module = importlib.util.module_from_spec(spec)",
      "spec.loader.exec_module(module)",
      "profile = {",
      "  'name': 'Charlotte Warehouse Leads',",
      "  'schedule': {'timezone': 'America/Toronto', 'metadata': {}},",
      "  'lastRunAt': None,",
      "}",
      "before = module.is_profile_due(profile, dt.datetime(2026, 7, 21, 10, 59, tzinfo=dt.timezone.utc))",
      "after = module.is_profile_due(profile, dt.datetime(2026, 7, 21, 11, 1, tzinfo=dt.timezone.utc))",
      "profile['lastRunAt'] = '2026-07-21T11:00:00.000Z'",
      "same_day = module.is_profile_due(profile, dt.datetime(2026, 7, 21, 18, 0, tzinfo=dt.timezone.utc))",
      "print(json.dumps({'before': before, 'after': after, 'sameDay': same_day}))"
    ].join("\n");

    const result = runWorkerProbe(python);

    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ before: false, after: true, sameDay: false });
  });

  it("fails closed when a deleted profile is absent from the current enabled list", () => {
    const python = [
      "import importlib.util, pathlib, sys",
      "worker_path = pathlib.Path(sys.argv[1])",
      "sys.path.insert(0, str(worker_path.parent))",
      "spec = importlib.util.spec_from_file_location('hunter_worker', worker_path)",
      "module = importlib.util.module_from_spec(spec)",
      "spec.loader.exec_module(module)",
      "try:",
      "  module.resolve_profile([], 'deleted-profile', None)",
      "except RuntimeError as error:",
      "  print(str(error))",
      "else:",
      "  raise RuntimeError('deleted profile unexpectedly resolved')"
    ].join("\n");

    const result = runWorkerProbe(python);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("not enabled");
  });
});
