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
      "  'destinationMarkets': ['Ontario | Canada', 'Quebec | Canada'],",
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
      consigneeCities: [],
      consigneeStates: ["Ontario | Canada", "Quebec | Canada"],
      consigneeCountries: ["Canada"],
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

  it("allows an explicit one-day test without changing the configured lookback", () => {
    const python = [
      "import importlib.util, json, os, pathlib, sys",
      "worker_path = pathlib.Path(sys.argv[1])",
      "sys.path.insert(0, str(worker_path.parent))",
      "spec = importlib.util.spec_from_file_location('hunter_worker', worker_path)",
      "module = importlib.util.module_from_spec(spec)",
      "spec.loader.exec_module(module)",
      "profile = {'lookbackDays': 120}",
      "os.environ['HUNTER_TEST_DAYS'] = '1'",
      "print(json.dumps({'queryDays': module.query_lookback_days(profile), 'configuredDays': module.profile_lookback_days(profile)}))"
    ].join("\n");

    const result = runWorkerProbe(python);

    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ queryDays: 1, configuredDays: 120 });
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

  it("resolves common U.S. port aliases to canonical TradeMining ports", () => {
    const python = [
      "import importlib.util, json, pathlib, sys",
      "worker_path = pathlib.Path(sys.argv[1])",
      "sys.path.insert(0, str(worker_path.parent))",
      "spec = importlib.util.spec_from_file_location('hunter_worker', worker_path)",
      "module = importlib.util.module_from_spec(spec)",
      "spec.loader.exec_module(module)",
      "profile = {",
      "  'id': 'profile-charlotte',",
      "  'name': 'Charlotte leads',",
      "  'destinationPorts': ['Charleston', 'Savannah', 'Wilmington'],",
      "  'lookbackDays': 1,",
      "  'schedule': {'timezone': 'America/Toronto', 'metadata': {}},",
      "  'lastRunAt': None,",
      "}",
      "plan = module.build_profile_plan(profile)",
      "print(json.dumps({'missing': plan['missingPortMappings'], 'ready': plan['ready']}))"
    ].join("\n");

    const result = runWorkerProbe(python);

    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ missing: [], ready: true });
  });

  it("plans a Canadian province as country plus state without a city fallback", () => {
    const python = [
      "import importlib.util, json, pathlib, sys",
      "worker_path = pathlib.Path(sys.argv[1])",
      "sys.path.insert(0, str(worker_path.parent))",
      "spec = importlib.util.spec_from_file_location('hunter_worker', worker_path)",
      "module = importlib.util.module_from_spec(spec)",
      "spec.loader.exec_module(module)",
      "profile = {",
      "  'id': 'profile-ontario',",
      "  'name': 'GTA leads',",
      "  'destinationPorts': [],",
      "  'destinationMarkets': ['Ontario | Canada'],",
      "  'lookbackDays': 120,",
      "  'schedule': {'timezone': 'America/Toronto', 'metadata': {}},",
      "  'lastRunAt': None,",
      "}",
      "plan = module.build_profile_plan(profile)",
      "print(json.dumps({'ports': plan['destinationPorts'], 'cities': plan['consigneeCities'], 'states': plan['consigneeStates'], 'countries': plan['consigneeCountries'], 'ready': plan['ready']}))"
    ].join("\n");

    const result = runWorkerProbe(python);

    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      ports: [],
      cities: [],
      states: ["Ontario | Canada"],
      countries: ["Canada"],
      ready: true
    });
  });

  it("fails closed when a legacy Canadian city is still configured", () => {
    const python = [
      "import importlib.util, pathlib, sys",
      "worker_path = pathlib.Path(sys.argv[1])",
      "sys.path.insert(0, str(worker_path.parent))",
      "spec = importlib.util.spec_from_file_location('hunter_worker', worker_path)",
      "module = importlib.util.module_from_spec(spec)",
      "spec.loader.exec_module(module)",
      "profile = {'destinationMarkets': ['Toronto | Canada']}",
      "try:",
      "  module.profile_destination_filters(profile)",
      "except RuntimeError as error:",
      "  print(str(error))",
      "  raise SystemExit(0)",
      "raise SystemExit(1)"
    ].join("\n");

    const result = runWorkerProbe(python);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain(
      'Canadian destination market "Toronto | Canada" must use Province | Canada'
    );
  });

  it("creates a tracked failed run before rejecting invalid port configuration", () => {
    const python = [
      "import importlib.util, json, pathlib, sys",
      "worker_path = pathlib.Path(sys.argv[1])",
      "sys.path.insert(0, str(worker_path.parent))",
      "spec = importlib.util.spec_from_file_location('hunter_worker', worker_path)",
      "module = importlib.util.module_from_spec(spec)",
      "spec.loader.exec_module(module)",
      "profile = {",
      "  'id': 'profile-toronto',",
      "  'name': 'Toronto leads',",
      "  'destinationPorts': ['Toronto'],",
      "  'destinationMarkets': ['Toronto | Canada'],",
      "  'lookbackDays': 1,",
      "}",
      "calls = []",
      "module.resolve_current_profile = lambda *_args: profile",
      "module.required_env = lambda name: '/tmp/hunter-test'",
      "module.load_port_ids = lambda: {}",
      "module.create_job_run = lambda *_args: calls.append('created') or 'job-1'",
      "module.fail_job_run = lambda *_args: calls.append('failed')",
      "try:",
      "  module.run_profile('https://example.com', 'token', profile, 'daily')",
      "except RuntimeError as error:",
      "  print(json.dumps({'calls': calls, 'error': str(error)}))",
      "else:",
      "  raise RuntimeError('invalid profile unexpectedly ran')"
    ].join("\n");

    const result = runWorkerProbe(python);

    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      calls: ["created", "failed"],
      error: "TradeMining port IDs are not configured for: Toronto"
    });
  });

  it("builds one daily Teams summary with coverage for every attempted profile", () => {
    const python = [
      "import importlib.util, json, pathlib, sys",
      "worker_path = pathlib.Path(sys.argv[1])",
      "sys.path.insert(0, str(worker_path.parent))",
      "spec = importlib.util.spec_from_file_location('hunter_worker', worker_path)",
      "module = importlib.util.module_from_spec(spec)",
      "spec.loader.exec_module(module)",
      "message = module.build_daily_trade_mining_message([{",
      "  'profileName': 'GTA Leads',",
      "  'matchedRecords': 184,",
      "  'exportedRecords': 180,",
      "  'recordsProcessed': 180,",
      "  'qualifyingCompanies': 24,",
      "  'queryCount': 3,",
      "  'retrievalComplete': True,",
      "}], [{'profileName': 'Charlotte Leads'}])",
      "print(json.dumps({'message': message}))"
    ].join("\n");

    const result = runWorkerProbe(python);

    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout).message).toContain(
      "Hunter TradeMining daily run finished: 1/2 profiles completed successfully."
    );
    expect(JSON.parse(result.stdout).message).toContain(
      "GTA Leads: 184 matches, 180 exported, 180 processed, 24 qualifying companies, 3 queries, retrieval complete."
    );
    expect(JSON.parse(result.stdout).message).toContain(
      "Charlotte Leads: failed. Review Admin & Quality → Health & Logs."
    );
  });

  it("sends an immediate failure alert and one final digest while continuing other due profiles", () => {
    const python = [
      "import importlib.util, json, pathlib, sys",
      "worker_path = pathlib.Path(sys.argv[1])",
      "sys.path.insert(0, str(worker_path.parent))",
      "spec = importlib.util.spec_from_file_location('hunter_worker', worker_path)",
      "module = importlib.util.module_from_spec(spec)",
      "spec.loader.exec_module(module)",
      "profiles = [",
      "  {'id': 'failed', 'name': 'Failed profile'},",
      "  {'id': 'ok', 'name': 'Healthy profile'},",
      "]",
      "module.load_profiles = lambda *_args: profiles",
      "module.load_run_requests = lambda *_args: []",
      "module.is_profile_due = lambda _profile: True",
      "def run_profile(_base_url, _token, profile, _trigger):",
      "  if profile['id'] == 'failed': raise RuntimeError('secret external detail')",
      "  return {'profileName': profile['name'], 'matchedRecords': 10, 'exportedRecords': 10, 'recordsProcessed': 10, 'qualifyingCompanies': 2, 'queryCount': 1, 'retrievalComplete': True}",
      "module.run_profile = run_profile",
      "messages = []",
      "module.send_teams_message = lambda message: messages.append(message) or True",
      "attempted = module.process_once('https://example.com', 'token', None, None)",
      "print(json.dumps({'attempted': attempted, 'messages': messages}))"
    ].join("\n");

    const result = runWorkerProbe(python);

    expect(result.status, result.stderr).toBe(0);
    const output = JSON.parse(result.stdout.trim().split("\n").at(-1) ?? "{}");
    expect(output.attempted).toBe(true);
    expect(output.messages).toHaveLength(2);
    expect(output.messages[0]).toContain('profile "Failed profile" failed');
    expect(output.messages[0]).not.toContain("secret external detail");
    expect(output.messages[1]).toContain("1/2 profiles completed successfully");
    expect(output.messages[1]).toContain("Healthy profile");
  });

  it("builds a safe company-research Teams completion summary", () => {
    const python = [
      "import importlib.util, json, pathlib, sys",
      "worker_path = pathlib.Path(sys.argv[1])",
      "sys.path.insert(0, str(worker_path.parent))",
      "spec = importlib.util.spec_from_file_location('hunter_worker', worker_path)",
      "module = importlib.util.module_from_spec(spec)",
      "spec.loader.exec_module(module)",
      "message = module.build_company_research_message({'researchedCount':29,'acceptedCount':8,'blockedCount':4,'missingCompanyCount':1})",
      "print(json.dumps({'message':message}))"
    ].join("\n");

    const result = runWorkerProbe(python);

    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout).message).toBe(
      "Hunter company research completed: 29 companies reached Luna and Kimi, 8 qualified for planning, 4 blocked, and 1 omitted after bounded model-output repair. Review Sales → Hunter Control Tower and Admin & Quality → Health & Logs."
    );
  });

  it("adds Luna primary and Qwen shadow coverage to the company-research Teams summary", () => {
    const python = [
      "import importlib.util, json, pathlib, sys",
      "worker_path = pathlib.Path(sys.argv[1])",
      "sys.path.insert(0, str(worker_path.parent))",
      "spec = importlib.util.spec_from_file_location('hunter_worker', worker_path)",
      "module = importlib.util.module_from_spec(spec)",
      "spec.loader.exec_module(module)",
      "message = module.build_company_research_message({'researchedCount':30,'acceptedCount':9,'blockedCount':3,'missingCompanyCount':0,'lunaComparison':{'status':'SUCCESS','evaluatedCompanyCount':30,'expectedCompanyCount':30,'firstPassSchemaValidCompanyCount':30,'qwenSynthesisCompanyCount':29,'qwenMissingCompanyCount':1,'categoricalAgreementPercent':86.7}})",
      "print(json.dumps({'message':message}))"
    ].join("\n");

    const result = runWorkerProbe(python);

    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout).message).toContain(
      "Luna primary: SUCCESS, 30/30 evaluated, 30 schema-valid on first pass, Qwen shadow returned 29 rows with 1 omissions; 86.7% categorical agreement with Qwen."
    );
  });

  it("reports new, refreshed, and suppressed company-research cohorts in Teams", () => {
    const python = [
      "import importlib.util, json, pathlib, sys",
      "worker_path = pathlib.Path(sys.argv[1])",
      "sys.path.insert(0, str(worker_path.parent))",
      "spec = importlib.util.spec_from_file_location('hunter_worker', worker_path)",
      "module = importlib.util.module_from_spec(spec)",
      "spec.loader.exec_module(module)",
      "message = module.build_company_research_message({'researchedCount':30,'acceptedCount':9,'blockedCount':3,'missingCompanyCount':0,'selection':{'cooldownDays':90,'selectedCompanyCount':30,'newCompanyCount':27,'scheduledRefreshSelectedCount':1,'materialRefreshSelectedCount':2,'recentResearchSuppressedCount':44,'activeOutreachSuppressedCount':6}})",
      "print(json.dumps({'message':message}))"
    ].join("\n");

    const result = runWorkerProbe(python);

    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout).message).toContain(
      "Cohort selection: 27/30 new companies, 1 scheduled refreshes, 2 new-trigger refreshes; 44 recent repeats and 6 active-outreach companies suppressed under the 90-day cooldown."
    );
  });

  it("sends a sanitized company-research failure alert", () => {
    const python = [
      "import importlib.util, json, pathlib, sys",
      "worker_path = pathlib.Path(sys.argv[1])",
      "sys.path.insert(0, str(worker_path.parent))",
      "spec = importlib.util.spec_from_file_location('hunter_worker', worker_path)",
      "module = importlib.util.module_from_spec(spec)",
      "spec.loader.exec_module(module)",
      "messages=[]",
      "module.send_teams_message=lambda message: messages.append(message) or True",
      "module.required_env=lambda name: 'redacted'",
      "module.report_failure=lambda *_args, **_kwargs: None",
      "module.run_company_research=lambda **_kwargs: (_ for _ in ()).throw(module.HunterCompanyResearchRunError(RuntimeError('invalid schema secret provider response'),'run-1','RETRIEVAL_COMPLETE'))",
      "try:",
      " module.run_company_research_with_notification()",
      "except module.HunterCompanyResearchRunError:",
      " pass",
      "print(json.dumps({'messages':messages}))"
    ].join("\n");

    const result = runWorkerProbe(python);
    const messages = (JSON.parse(result.stdout) as { messages: string[] }).messages;

    expect(result.status, result.stderr).toBe(0);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("bounded checkpoint recovery");
    expect(messages[0]).not.toContain("secret provider response");
  });

  it("retries transient company research against the exact failed run", () => {
    const python = [
      "import importlib.util, json, pathlib, sys",
      "worker_path = pathlib.Path(sys.argv[1])",
      "sys.path.insert(0, str(worker_path.parent))",
      "spec = importlib.util.spec_from_file_location('hunter_worker', worker_path)",
      "module = importlib.util.module_from_spec(spec)",
      "spec.loader.exec_module(module)",
      "calls=[]",
      "failures=[]",
      "messages=[]",
      "module.required_env=lambda name: 'redacted'",
      "module.time.sleep=lambda seconds: None",
      "module.send_teams_message=lambda message: messages.append(message) or True",
      "module.report_failure=lambda *_args, **kwargs: failures.append(kwargs)",
      "def research(**kwargs):",
      " calls.append(kwargs)",
      " if len(calls)==1: raise module.HunterCompanyResearchRunError(RuntimeError('database connection pool unavailable'),'run-1','RETRIEVAL_COMPLETE')",
      " return {'runId':'run-2','researchedCount':30,'acceptedCount':8,'blockedCount':3,'missingCompanyCount':0}",
      "module.run_company_research=research",
      "result=module.run_company_research_with_notification()",
      "print(json.dumps({'calls':calls,'failures':failures,'messages':messages,'result':result}))"
    ].join("\n");

    const result = runWorkerProbe(python);
    const payload = JSON.parse(result.stdout) as {
      calls: Array<Record<string, unknown>>;
      failures: Array<Record<string, unknown>>;
      messages: string[];
      result: Record<string, unknown>;
    };

    expect(result.status, result.stderr).toBe(0);
    expect(payload.calls).toHaveLength(2);
    expect(payload.calls[1].recovery_of_run_id).toBe("run-1");
    expect(payload.failures[0]).toMatchObject({
      retryable: true,
      retry_scheduled: true,
      checkpoint_stage: "RETRIEVAL_COMPLETE"
    });
    expect(payload.result.automaticRecovery).toEqual({ recovered: true, attempt: 2 });
    expect(payload.messages.some((message) => message.includes("attempt 2/3"))).toBe(true);
  });

  it("can explicitly recover the exact cohort from a failed research run", () => {
    const python = [
      "import contextlib, importlib.util, io, json, pathlib, sys",
      "worker_path = pathlib.Path(sys.argv[1])",
      "sys.path.insert(0, str(worker_path.parent))",
      "spec = importlib.util.spec_from_file_location('hunter_worker', worker_path)",
      "module = importlib.util.module_from_spec(spec)",
      "spec.loader.exec_module(module)",
      "captured=[]",
      "module.required_env=lambda name: 'redacted'",
      "module.run_company_research_with_notification=lambda **kwargs: captured.append(kwargs) or {'state':'recovered'}",
      "sys.argv=[str(worker_path),'--company-research-recovery-run-id','run-50']",
      "with contextlib.redirect_stdout(io.StringIO()): status=module.main()",
      "print(json.dumps({'status':status,'captured':captured}))"
    ].join("\n");

    const result = runWorkerProbe(python);
    expect(result.status, result.stderr).toBe(0);
    const lines = result.stdout.trim().split("\n");
    const payload = JSON.parse(lines.at(-1) ?? "{}") as {
      status: number;
      captured: Array<Record<string, unknown>>;
    };
    expect(payload.status).toBe(0);
    expect(payload.captured).toHaveLength(1);
    expect(payload.captured[0]).toMatchObject({
      force: true,
      recovery_of_run_id: "run-50"
    });
  });
});
