import { spawnSync } from "node:child_process";
import path from "node:path";

import { describe, expect, it } from "vitest";

const exporterPath = path.join(process.cwd(), "ops/openclaw/hunter/trademining_export.py");

describe("Hunter TradeMining profile query", () => {
  it("encodes all profile filters in one multi-port BOL form post", () => {
    const source = [
      "import datetime as dt, importlib.util, json, pathlib, sys, urllib.parse",
      "path = pathlib.Path(sys.argv[1])",
      "spec = importlib.util.spec_from_file_location('trademining_export', path)",
      "module = importlib.util.module_from_spec(spec)",
      "sys.modules[spec.name] = module",
      "spec.loader.exec_module(module)",
      "form = module.build_search_form(",
      "  token='test-token',",
      "  port_ids=['1237', '1233', '1241'],",
      "  start_date=dt.date(2026, 3, 22),",
      "  end_date=dt.date(2026, 7, 19),",
      "  origin_country_ids=['VN', 'TH'],",
      "  origin_port_ids=['HCM', 'LCH'],",
      "  ship_from_ports=['Ho Chi Minh', 'Busan'],",
      "  product_keywords=['consumer goods', 'fixtures'],",
      "  hs_codes=['6109', '9403'],",
      "  minimum_teu=10,",
      ")",
      "encoded = urllib.parse.urlencode(form, doseq=True)",
      "print(json.dumps({'form': form, 'encoded': encoded}))"
    ].join("\n");

    const result = spawnSync("python3", ["-c", source, exporterPath], {
      encoding: "utf8",
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" }
    });

    expect(result.status, result.stderr).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.form).toMatchObject({
      USPort: ["1237", "1233", "1241"],
      CountryOfOrigin: ["VN", "TH"],
      ForeignPort: ["HCM", "LCH"],
      PlaceOfReceipt: '"Ho Chi Minh" OR Busan',
      ContainerCommodity: '"consumer goods" OR fixtures',
      HTSCode: "6109 OR 9403",
      TEUFromSingle: "Greater Than Or Equals To",
      TEUToSingle: "10"
    });
    expect(parsed.encoded.match(/USPort=/g)).toHaveLength(3);
  });

  it("retries transient TradeMining responses but not authentication failures", () => {
    const source = [
      "import importlib.util, json, pathlib, sys, tempfile",
      "path = pathlib.Path(sys.argv[1])",
      "spec = importlib.util.spec_from_file_location('trademining_export', path)",
      "module = importlib.util.module_from_spec(spec)",
      "sys.modules[spec.name] = module",
      "spec.loader.exec_module(module)",
      "class Headers:",
      "  def get_all(self, name): return []",
      "  def items(self): return []",
      "class Response:",
      "  def __init__(self, status): self.status=status; self.headers=Headers()",
      "  def read(self): return b'{}'",
      "class Opener:",
      "  def __init__(self, statuses): self.statuses=list(statuses); self.calls=0",
      "  def open(self, request, timeout=120): self.calls += 1; return Response(self.statuses.pop(0))",
      "module.time.sleep = lambda _seconds: None",
      "with tempfile.TemporaryDirectory() as directory:",
      "  transient = Opener([503, 200])",
      "  module.urllib.request.build_opener = lambda *_args: transient",
      "  session = module.TradeMiningSession(pathlib.Path(directory) / 'cookies')",
      "  transient_status = session.request('GET', '/ImportSearch')[0]",
      "  auth = Opener([401, 200])",
      "  module.urllib.request.build_opener = lambda *_args: auth",
      "  auth_status = session.request('GET', '/ImportSearch')[0]",
      "print(json.dumps({'transientCalls': transient.calls, 'transientStatus': transient_status, 'authCalls': auth.calls, 'authStatus': auth_status}))"
    ].join("\n");

    const result = spawnSync("python3", ["-c", source, exporterPath], {
      encoding: "utf8",
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1", HUNTER_HTTP_MAX_ATTEMPTS: "4" }
    });

    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      transientCalls: 2,
      transientStatus: 200,
      authCalls: 1,
      authStatus: 401
    });
  });
});
