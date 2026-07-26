import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import {
  HUNTER_COMPANY_RESEARCH_DEFAULT_KIMI_MODEL,
  HUNTER_COMPANY_RESEARCH_DEFAULT_QWEN_MODEL,
  HUNTER_COMPANY_RESEARCH_DEFAULT_VALIDATOR_MODEL,
  HUNTER_COMPANY_RESEARCH_PROMPT_VERSION,
  HUNTER_COMPANY_RESEARCH_SAFETY,
  classifyResearchOpportunity,
  evaluateResearchGate,
  parseHunterCompanyResearchCompletion
} from "@/modules/lead-gen/hunter-company-research";

const execFileAsync = promisify(execFile);
const repoRoot = process.cwd();
const researchPath = path.join(repoRoot, "ops/openclaw/hunter/hunter_company_research.py");
const workerPath = path.join(repoRoot, "ops/openclaw/hunter/hunter_worker.py");
const runnerPath = path.join(repoRoot, "ops/openclaw/run-hunter-worker.sh");

describe("Hunter company deep research", () => {
  it("keeps the three-stage model pipeline dry-run only", () => {
    expect(HUNTER_COMPANY_RESEARCH_DEFAULT_QWEN_MODEL).toBe("qwen3.5:35b");
    expect(HUNTER_COMPANY_RESEARCH_DEFAULT_KIMI_MODEL).toBe("kimi-k2.6");
    expect(HUNTER_COMPANY_RESEARCH_DEFAULT_VALIDATOR_MODEL).toBe("kimi-k3");
    expect(HUNTER_COMPANY_RESEARCH_PROMPT_VERSION).toBe("hunter-company-research-v8");
    expect(HUNTER_COMPANY_RESEARCH_SAFETY).toEqual({
      externalWrites: false,
      apollo: false,
      outreach: false,
      cadenceWrites: false,
      pipelineStageChanges: false
    });
  });

  it("accepts an evidence-backed scored and validated completion", () => {
    const parsed = parseHunterCompanyResearchCompletion(completion());

    expect(parsed.companies[0].scoring.totalScore).toBe(70);
    expect(evaluateResearchGate(parsed.companies[0])).toEqual({
      passed: true,
      blockers: []
    });
  });

  it("makes only K3-confirmed fresh events hot", () => {
    const company = parseHunterCompanyResearchCompletion(completion()).companies[0];
    const gate = evaluateResearchGate(company);

    expect(
      classifyResearchOpportunity(company, gate, {
        minimumPriorityScore: 35,
        minimumSignalConfidence: 50
      }).tier
    ).toBe("HOT_OPPORTUNITY");
    expect(
      classifyResearchOpportunity(
        { ...company, validation: { ...company.validation, status: "ERROR", disposition: null } },
        gate,
        { minimumPriorityScore: 35, minimumSignalConfidence: 50 }
      ).tier
    ).toBe("WATCHLIST");
  });

  it("classifies strong current accounts without requiring K3", () => {
    const company = parseHunterCompanyResearchCompletion(completion()).companies[0];
    const current = {
      ...company,
      synthesis: { ...company.synthesis, freshness: "CURRENT" as const },
      validation: {
        ...company.validation,
        status: "NOT_SELECTED" as const,
        disposition: null,
        validatedScore: null,
        confidence: null,
        rationale: null,
        supportingEvidenceIndices: []
      }
    };

    expect(
      classifyResearchOpportunity(current, evaluateResearchGate(current), {
        minimumPriorityScore: 35,
        minimumSignalConfidence: 50
      }).tier
    ).toBe("QUALIFIED_CURRENT_ACCOUNT");
  });

  it("deprioritizes foreign companies and blocks China without a verified U.S. division", () => {
    const company = parseHunterCompanyResearchCompletion(completion()).companies[0];
    const foreign = {
      ...company,
      synthesis: {
        ...company.synthesis,
        companyCountry: "France",
        operatingRegion: "NORTH_AMERICA" as const
      }
    };
    const foreignResult = classifyResearchOpportunity(
      foreign,
      evaluateResearchGate(foreign),
      { minimumPriorityScore: 35, minimumSignalConfidence: 50 }
    );
    expect(foreignResult.tier).toBe("WATCHLIST");
    expect(foreignResult.foreignPriorityAdjustment).toBe(-10);

    const china = {
      ...company,
      synthesis: {
        ...company.synthesis,
        companyCountry: "China",
        operatingRegion: "CHINA" as const,
        verifiedUsDivision: false,
        usDivisionName: null,
        usDivisionEvidenceIndices: []
      }
    };
    expect(evaluateResearchGate(china).blockers).toContain(
      "Mainland-China company has no verified U.S. operating division."
    );

    const unsupportedDivision = {
      ...china,
      synthesis: {
        ...china.synthesis,
        verifiedUsDivision: true,
        usDivisionName: "Example USA Inc.",
        usDivisionEvidenceIndices: [0]
      }
    };
    expect(evaluateResearchGate(unsupportedDivision).blockers).toContain(
      "The claimed U.S. division is not verified by the cited public identity evidence."
    );
  });

  it("blocks uncorroborated identities and evidence-backed disqualifiers, but not unsupported model labels", () => {
    const parsed = parseHunterCompanyResearchCompletion(completion());
    const company = parsed.companies[0];

    expect(
      evaluateResearchGate({
        ...company,
        synthesis: { ...company.synthesis, identityDisposition: "AMBIGUOUS" },
        evidence: company.evidence.map((item) => ({
          ...item,
          firstParty: false,
          sourceType: item.sourceType === "FIRST_PARTY" ? "OTHER" as const : item.sourceType
        }))
      }).passed
    ).toBe(false);
    expect(
      evaluateResearchGate({
        ...company,
        synthesis: { ...company.synthesis, logisticsProvider: true }
      }).passed
    ).toBe(true);
    expect(
      evaluateResearchGate({
        ...company,
        evidence: company.evidence.map((item, index) =>
          index === 1
            ? {
                ...item,
                excerpt:
                  "The company signed a long-term warehousing provider contract for all North American distribution."
              }
            : item
        ),
        synthesis: {
          ...company.synthesis,
          namedExternalLogisticsProvider: true,
          stableExclusiveProviderEvidence: true,
          providerDisplacementEvidence: false
        }
      }).blockers
    ).toContain("Evidence shows a stable exclusive provider relationship without a credible displacement trigger.");
    expect(evaluateResearchGate({ ...company, evidence: company.evidence.slice(0, 1) }).passed).toBe(false);
  });

  it("retains stale or missing opportunity evidence on the watchlist instead of blocking the company", () => {
    const company = parseHunterCompanyResearchCompletion(completion()).companies[0];
    const staleCompany = {
      ...company,
      synthesis: {
        ...company.synthesis,
        freshness: "STALE" as const
      }
    };
    const gate = evaluateResearchGate(staleCompany);
    const result = classifyResearchOpportunity(staleCompany, gate, {
      minimumPriorityScore: 35,
      minimumSignalConfidence: 50
    });

    expect(gate.passed).toBe(true);
    expect(result.tier).toBe("WATCHLIST");
    expect(result.tierReasons).toContain(
      "Current opportunity evidence was not established; retained for later research instead of being permanently blocked."
    );
  });

  it("blocks explicit provider-service evidence even when Qwen misses the provider classification", () => {
    const company = parseHunterCompanyResearchCompletion(completion()).companies[0];
    const result = evaluateResearchGate({
      ...company,
      evidence: company.evidence.map((item, index) =>
        index === 0
          ? {
              ...item,
              excerpt:
                "The company is a manufacturer-owned provider of shared ecommerce and logistics services."
            }
          : item
      )
    });

    expect(result.blockers).toContain(
      "Public evidence explicitly describes the company providing logistics services to others."
    );
  });

  it("does not treat unrelated third-party careers text as provider-service evidence", () => {
    const company = parseHunterCompanyResearchCompletion(completion()).companies[0];
    const result = evaluateResearchGate({
      ...company,
      evidence: company.evidence.map((item, index) =>
        index === 0
          ? {
              ...item,
              pass: "CAREERS",
              firstParty: false,
              excerpt: "A job aggregator also advertises another employer that provides freight forwarding services."
            }
          : item
      )
    });

    expect(result.blockers).not.toContain(
      "Public evidence explicitly describes the company providing logistics services to others."
    );
  });

  it("evaluates unsupported fresh claims as current accounts instead of blocking them", () => {
    const company = parseHunterCompanyResearchCompletion(completion()).companies[0];
    const unsupportedFresh = {
      ...company,
      evidence: company.evidence.map((item) =>
        item.pass === "FRESH_EVENTS"
          ? { ...item, publishedAt: "2010-02-10T00:00:00.000Z" }
          : item
      )
    };
    const gate = evaluateResearchGate(unsupportedFresh);
    const result = classifyResearchOpportunity(unsupportedFresh, gate, {
      minimumPriorityScore: 35,
      minimumSignalConfidence: 50
    });

    expect(gate.passed).toBe(true);
    expect(result.tier).toBe("QUALIFIED_CURRENT_ACCOUNT");
    expect(result.tierReasons).toContain(
      "The claimed fresh event lacked a recent dated source and was evaluated as current account fit instead."
    );
  });

  it("does not block an ambiguous model label when matching first-party identity evidence corroborates it", () => {
    const company = parseHunterCompanyResearchCompletion(completion()).companies[0];
    const corroborated = {
      ...company,
      synthesis: {
        ...company.synthesis,
        identityDisposition: "AMBIGUOUS" as const,
        identityConfidence: 45
      }
    };

    expect(evaluateResearchGate(corroborated).blockers).not.toContain(
      "Company identity was not confirmed at 70% or better."
    );
  });

  it("rejects forged domains and model arithmetic", () => {
    const forged = completion();
    forged.companies[0].evidence[0].sourceDomain = "different.example";
    expect(() => parseHunterCompanyResearchCompletion(forged)).toThrow(/must match the evidence URL hostname/);

    const badTotal = completion();
    badTotal.companies[0].scoring.totalScore = 99;
    expect(() => parseHunterCompanyResearchCompletion(badTotal)).toThrow(/must equal the five deterministic/);

    const promoted = completion();
    promoted.companies[0].validation.validatedScore = 71;
    expect(() => parseHunterCompanyResearchCompletion(promoted)).toThrow(/cannot exceed the K2.6 score/);
  });

  it("schedules the bounded local worker and contains no outreach integration", async () => {
    const [research, worker, runner] = await Promise.all([
      readFile(researchPath, "utf8"),
      readFile(workerPath, "utf8"),
      readFile(runnerPath, "utf8")
    ]);

    expect(worker).toContain("company_research_due_now");
    expect(worker).toContain('HUNTER_COMPANY_RESEARCH_DAILY_TIME", "09:15"');
    expect(worker).toContain("--company-research-cohort");
    expect(research).toContain("IDENTITY");
    expect(research).toContain("FRESH_EVENTS");
    expect(research).toContain("CAREERS");
    expect(research).toContain("DISTRIBUTION_FOOTPRINT");
    expect(research).toContain('"think": False');
    expect(research).toContain("kimi-k2.6");
    expect(research).toContain("select_model_evidence");
    expect(research).toContain("ordinary internal operations");
    expect(research).toContain("Do not silently substitute a plausible parent");
    expect(research).toContain("separate customers or member companies");
    expect(research).toContain("parse_brave_published_at");
    expect(research).toContain("parse_page_published_at");
    expect(research).toContain("triggerEvidenceIndices");
    expect(research).toContain("must cite one to five trigger evidence records");
    expect(research).toContain("whose supplied publishedAt value is within 18 months");
    expect(research).toContain('"thinking": {"type": "disabled"}');
    expect(research).toContain('"temperature": 0.6');
    expect(research).toContain('"max_tokens": 16_000');
    expect(research).toContain('"submit_hunter_company_scores"');
    expect(research).toContain('"tool_choice"');
    expect(research).toContain('HUNTER_RESEARCH_KIMI_BATCH_SIZE", "5"');
    expect(research).toContain('HUNTER_RESEARCH_K3_VALIDATOR_LIMIT", "5"');
    expect(research).toContain('"reasoning_effort": reasoning_effort.lower()');
    expect(research).toContain('"type": "json_schema"');
    expect(research).toContain("kimi-k3");
    expect(research).toContain("companyCountry");
    expect(research).toContain("never from TradeMining shipment origin");
    expect(research).not.toContain("api.apollo.io");
    expect(
      await readFile(path.join(repoRoot, "src/modules/lead-gen/hunter-company-research.ts"), "utf8")
    ).toContain("company.evidence[company.synthesis.triggerEvidenceIndices[0]]");
    expect(runner).toContain("HUNTER_COMPANY_RESEARCH_ENABLED");
    expect(runner).toContain("HUNTER_RESEARCH_SEARCH_PROVIDER");
  });

  it("passes Python and zsh syntax validation", async () => {
    await expect(
      execFileAsync("python3", ["-m", "py_compile", workerPath, researchPath], {
        env: {
          ...process.env,
          PYTHONPYCACHEPREFIX: "/private/tmp/newl-hunter-company-research-tests"
        }
      })
    ).resolves.toBeDefined();
    await expect(execFileAsync("/bin/zsh", ["-n", runnerPath])).resolves.toBeDefined();
  });

  it("builds all four company-specific research queries", async () => {
    const program = [
      "import json",
      "import hunter_company_research as r",
      "rows=r.build_research_queries({'companyName':'Example Retailer','domain':'example.com'})",
      "print(json.dumps(rows))"
    ].join(";");
    const { stdout } = await execFileAsync("python3", ["-c", program], {
      env: {
        ...process.env,
        PYTHONPATH: path.join(repoRoot, "ops/openclaw/hunter"),
        PYTHONPYCACHEPREFIX: "/private/tmp/newl-hunter-company-research-tests"
      }
    });
    const rows = JSON.parse(stdout) as Array<{ pass: string; query: string }>;

    expect(rows.map((row) => row.pass)).toEqual([
      "IDENTITY",
      "FRESH_EVENTS",
      "CAREERS",
      "DISTRIBUTION_FOOTPRINT",
      "IDENTITY",
      "FRESH_EVENTS"
    ]);
    expect(rows.slice(0, 4).every((row) => row.query.includes("Example Retailer"))).toBe(true);
    expect(rows.some((row) => row.query.includes("site:example.com"))).toBe(true);
  });

  it("uses legal-name aliases and recognizes matching official domains as first party", async () => {
    const program = [
      "import json",
      "import hunter_company_research as r",
      "aalberts={'companyName':'AALBERTS IPS AMERICAS','domain':None}",
      "as_colour={'companyName':'AS COLOUR INC.','domain':None}",
      "three_f={'companyName':'3F NORTH AMERICA INC.','domain':None}",
      "barnhardt={'companyName':'BARNHARDT MANUFACTURING CO.','domain':None}",
      "atlas={'companyName':'ATLAS COPCO COMPRESSORS LLC','domain':None}",
      "print(json.dumps({'aalberts':r.company_search_aliases(aalberts),'asColour':r.company_search_aliases(as_colour),'threeF':r.company_search_aliases(three_f),'barnhardt':r.company_search_aliases(barnhardt),'atlas':r.company_search_aliases(atlas),'official':r.is_likely_first_party(barnhardt,'barnhardt.net'),'directory':r.is_likely_first_party(barnhardt,'zoominfo.com')}))"
    ].join(";");
    const { stdout } = await execFileAsync("python3", ["-c", program], {
      env: {
        ...process.env,
        PYTHONPATH: path.join(repoRoot, "ops/openclaw/hunter"),
        PYTHONPYCACHEPREFIX: "/private/tmp/newl-hunter-company-research-tests"
      }
    });

    expect(JSON.parse(stdout)).toEqual({
      aalberts: ["AALBERTS IPS AMERICAS", "AALBERTS IPS", "AALBERTS"],
      asColour: ["AS COLOUR INC.", "AS COLOUR"],
      threeF: ["3F NORTH AMERICA INC.", "3F NORTH AMERICA"],
      barnhardt: ["BARNHARDT MANUFACTURING CO.", "BARNHARDT MANUFACTURING", "BARNHARDT"],
      atlas: ["ATLAS COPCO COMPRESSORS LLC", "ATLAS COPCO COMPRESSORS", "ATLAS COPCO"],
      official: true,
      directory: false
    });
  });

  it("normalizes undated fresh claims and corroborated first-party identities before Kimi scoring", async () => {
    const program = [
      "import json",
      "import hunter_company_research as r",
      "candidate={'companyName':'BARNHARDT MANUFACTURING CO.','companyKey':'barnhardt-manufacturing-co'}",
      "evidence=[{'pass':'IDENTITY','firstParty':True,'sourceType':'FIRST_PARTY','title':'Barnhardt Manufacturing Company','excerpt':'Barnhardt Manufacturing Company is based in Charlotte.'},{'pass':'FRESH_EVENTS','firstParty':False,'sourceType':'OTHER','title':'Company profile','excerpt':'Current operations','publishedAt':None}]",
      "synthesis={'identityDisposition':'AMBIGUOUS','identityConfidence':45,'identityReason':'Directory conflict.','confidence':40,'freshness':'FRESH','triggerEvidenceIndices':[1],'missingEvidence':[],'rationale':'Undated activity.','logisticsProvider':True,'stableExclusiveProviderEvidence':True}",
      "print(json.dumps(r.normalize_synthesis_for_evidence(candidate,evidence,synthesis)))"
    ].join(";");
    const { stdout } = await execFileAsync("python3", ["-c", program], {
      env: {
        ...process.env,
        PYTHONPATH: path.join(repoRoot, "ops/openclaw/hunter"),
        PYTHONPYCACHEPREFIX: "/private/tmp/newl-hunter-company-research-tests"
      }
    });
    const normalized = JSON.parse(stdout) as {
      freshness: string;
      identityDisposition: string;
      identityConfidence: number;
      confidence: number;
      logisticsProvider: boolean;
      stableExclusiveProviderEvidence: boolean;
    };

    expect(normalized).toMatchObject({
      freshness: "CURRENT",
      identityDisposition: "PASS",
      identityConfidence: 70,
      confidence: 60,
      logisticsProvider: false,
      stableExclusiveProviderEvidence: false
    });
  });

  it("sends a compact, pass-diverse evidence packet to the models", async () => {
    const program = [
      "import json",
      "import hunter_company_research as r",
      "rows=[]",
      "passes=['IDENTITY','FRESH_EVENTS','CAREERS','DISTRIBUTION_FOOTPRINT']",
      "sources=['DIRECTORY','NEWS','CAREERS','FIRST_PARTY']",
      "[(rows.append({'pass':passes[i%4],'sourceType':sources[i%4],'firstParty':i%4==3,'excerpt':'x'*1000,'title':str(i)})) for i in range(12)]",
      "print(json.dumps(r.select_model_evidence(rows)))"
    ].join(";");
    const { stdout } = await execFileAsync("python3", ["-c", program], {
      env: {
        ...process.env,
        PYTHONPATH: path.join(repoRoot, "ops/openclaw/hunter"),
        PYTHONPYCACHEPREFIX: "/private/tmp/newl-hunter-company-research-tests"
      }
    });
    const rows = JSON.parse(stdout) as Array<{ pass: string; excerpt: string; evidenceIndex: number }>;

    expect(rows).toHaveLength(5);
    expect(new Set(rows.map((row) => row.pass))).toEqual(
      new Set(["IDENTITY", "FRESH_EVENTS", "CAREERS", "DISTRIBUTION_FOOTPRINT"])
    );
    expect(rows.every((row) => row.excerpt.length <= 700)).toBe(true);
    expect(rows.every((row) => Number.isInteger(row.evidenceIndex))).toBe(true);
  });

  it("parses a Kimi JSON object wrapped in explanatory text", async () => {
    const program = [
      "import json",
      "import hunter_company_research as r",
      "print(json.dumps(r.parse_json_object('Result follows: {\"companies\": []} done.')))"
    ].join(";");
    const { stdout } = await execFileAsync("python3", ["-c", program], {
      env: {
        ...process.env,
        PYTHONPATH: path.join(repoRoot, "ops/openclaw/hunter"),
        PYTHONPYCACHEPREFIX: "/private/tmp/newl-hunter-company-research-tests"
      }
    });

    expect(JSON.parse(stdout)).toEqual({ companies: [] });
  });

  it("bounds evidence excerpts using the server's UTF-16 length semantics", async () => {
    const program = [
      "import json",
      "import hunter_company_research as r",
      "value=r.bounded_utf16_text('😀'*1500,'',2000)",
      "print(json.dumps({'characters':len(value),'utf16Units':len(value.encode('utf-16-le'))//2}))"
    ].join(";");
    const { stdout } = await execFileAsync("python3", ["-c", program], {
      env: {
        ...process.env,
        PYTHONPATH: path.join(repoRoot, "ops/openclaw/hunter"),
        PYTHONPYCACHEPREFIX: "/private/tmp/newl-hunter-company-research-tests"
      }
    });

    expect(JSON.parse(stdout)).toEqual({ characters: 1000, utf16Units: 2000 });
  });

  it("normalizes Brave page ages into auditable UTC publication dates", async () => {
    const program = [
      "import json",
      "import hunter_company_research as r",
      "print(json.dumps(r.parse_brave_published_at('2010-02-10T00:00:00')))"
    ].join(";");
    const { stdout } = await execFileAsync("python3", ["-c", program], {
      env: {
        ...process.env,
        PYTHONPATH: path.join(repoRoot, "ops/openclaw/hunter"),
        PYTHONPYCACHEPREFIX: "/private/tmp/newl-hunter-company-research-tests"
      }
    });

    expect(JSON.parse(stdout)).toBe("2010-02-10T00:00:00+00:00");
  });

  it("prefers an article's original publication date over a later page update", async () => {
    const program = [
      "import json",
      "import hunter_company_research as r",
      "html='<meta property=\"article:published_time\" content=\"2022-02-25T12:38:00Z\"><meta property=\"article:modified_time\" content=\"2025-12-11T14:33:48Z\">'",
      "print(json.dumps(r.parse_page_published_at(html)))"
    ].join(";");
    const { stdout } = await execFileAsync("python3", ["-c", program], {
      env: {
        ...process.env,
        PYTHONPATH: path.join(repoRoot, "ops/openclaw/hunter"),
        PYTHONPYCACHEPREFIX: "/private/tmp/newl-hunter-company-research-tests"
      }
    });

    expect(JSON.parse(stdout)).toBe("2022-02-25T12:38:00+00:00");
  });

  it("selects only accessible fresh leaders for K3 and uses current cost rates", async () => {
    const program = [
      "import datetime as d,json",
      "import hunter_company_research as r",
      "candidate={'companyKey':'example','companyName':'Example','priorityScore':80}",
      "evidence=[{'pass':'IDENTITY'},{'pass':'FRESH_EVENTS','publishedAt':d.datetime.now(d.timezone.utc).isoformat()}]",
      "synthesis={'identityDisposition':'PASS','identityConfidence':90,'logisticsProvider':False,'stableExclusiveProviderEvidence':False,'providerDisplacementEvidence':False,'freshness':'FRESH','triggerEvidenceIndices':[1],'operatingRegion':'NORTH_AMERICA','verifiedUsDivision':False,'confidence':85}",
      "scoring={'totalScore':70,'confidence':80}",
      "chosen=r.select_k3_candidates([candidate],{'example':evidence},{'example':synthesis},{'example':scoring},5,35,50)",
      "print(json.dumps({'keys':[x['companyKey'] for x in chosen],'k2':r.estimate_kimi_cost(1000,100,200),'k3':r.estimate_k3_cost(1000,100,200)}))"
    ].join(";");
    const { stdout } = await execFileAsync("python3", ["-c", program], {
      env: {
        ...process.env,
        PYTHONPATH: path.join(repoRoot, "ops/openclaw/hunter"),
        PYTHONPYCACHEPREFIX: "/private/tmp/newl-hunter-company-research-tests"
      }
    });

    expect(JSON.parse(stdout)).toEqual({
      keys: ["example"],
      k2: 0.001671,
      k3: 0.00573
    });
  });
});

function completion() {
  return {
    models: {
      synthesis: {
        provider: "OLLAMA",
        name: "qwen3.5:35b",
        promptVersion: "hunter-company-research-v8",
        structuredOutput: true,
        inputTokens: 2000,
        outputTokens: 700,
        durationMs: 4000
      },
      scoring: {
        provider: "KIMI",
        name: "kimi-k2.6",
        promptVersion: "hunter-company-research-v8",
        structuredOutput: true,
        inputTokens: 1800,
        cachedInputTokens: 200,
        outputTokens: 500,
        durationMs: 3000,
        estimatedCostUsd: 0.003
      },
      validation: {
        provider: "KIMI",
        name: "kimi-k3",
        promptVersion: "hunter-company-research-v8",
        structuredOutput: true,
        status: "SUCCESS",
        reasoningEffort: "LOW",
        candidateCount: 1,
        inputTokens: 1200,
        cachedInputTokens: 100,
        outputTokens: 300,
        durationMs: 2500,
        estimatedCostUsd: 0.008,
        errorMessage: null
      }
    },
    search: {
      provider: "BRAVE",
      retrievedAt: "2026-07-26T14:00:00.000Z",
      queryCount: 4,
      pageFetchCount: 2,
      failedQueryCount: 0
    },
    companies: [
      {
        companyId: "company-1",
        companyKey: "example retailer",
        companyName: "Example Retailer",
        evidence: [
          {
            pass: "IDENTITY",
            query: '"Example Retailer" official company about parent ownership',
            title: "About Example Retailer",
            url: "https://www.example.com/about",
            sourceDomain: "www.example.com",
            sourceType: "FIRST_PARTY",
            publishedAt: null,
            excerpt: "Example Retailer operates stores throughout the Southeast.",
            firstParty: true
          },
          {
            pass: "FRESH_EVENTS",
            query: '"Example Retailer" expansion 2026',
            title: "Example Retailer opens a North Carolina distribution center",
            url: "https://news.example.org/retailer-expansion",
            sourceDomain: "news.example.org",
            sourceType: "NEWS",
            publishedAt: "2026-06-01T12:00:00.000Z",
            excerpt: "The retailer announced a new North Carolina distribution center.",
            firstParty: false
          }
        ],
        synthesis: {
          identityDisposition: "PASS",
          identityConfidence: 94,
          identityReason: "The official company identity and operating footprint match.",
          logisticsProvider: false,
          namedExternalLogisticsProvider: false,
          stableExclusiveProviderEvidence: false,
          providerDisplacementEvidence: false,
          freshness: "FRESH",
          opportunitySummary: "A new North Carolina distribution center creates a warehousing trigger.",
          triggerEvidenceIndices: [1],
          geography: "North Carolina",
          companyCountry: "United States",
          operatingRegion: "NORTH_AMERICA",
          verifiedUsDivision: false,
          usDivisionName: null,
          usDivisionEvidenceIndices: [],
          serviceLine: "WAREHOUSING",
          signalType: "FACILITY_OPENING",
          confidence: 86,
          rationale: "The dated facility announcement directly supports near-term distribution demand.",
          missingEvidence: ["Whether overflow warehousing will be outsourced"]
        },
        scoring: {
          serviceLine: "WAREHOUSING",
          opportunityType: "North Carolina distribution-center opening",
          rationale: "Fresh first-party identity plus a dated facility opening creates a strong trigger.",
          recommendedPersona: "VP or Director of Supply Chain / Distribution",
          recommendedCadence: "Triggered warehousing expansion",
          dimensionScores: {
            demandTrigger: 17,
            serviceFit: 18,
            timing: 15,
            accessibility: 9,
            evidenceQuality: 11
          },
          totalScore: 70,
          confidence: 82
        },
        validation: {
          status: "VALIDATED",
          disposition: "CONFIRM",
          validatedScore: 68,
          confidence: 80,
          rationale: "The dated facility opening is a credible logistics trigger.",
          riskFlags: ["OUTSOURCING_NOT_CONFIRMED"],
          supportingEvidenceIndices: [1]
        }
      }
    ]
  };
}
