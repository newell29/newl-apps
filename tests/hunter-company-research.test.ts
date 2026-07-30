import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import {
  HUNTER_COMPANY_RESEARCH_DEFAULT_KIMI_MODEL,
  HUNTER_COMPANY_RESEARCH_DEFAULT_LUNA_MODEL,
  HUNTER_COMPANY_RESEARCH_DEFAULT_QWEN_MODEL,
  HUNTER_COMPANY_RESEARCH_DEFAULT_VALIDATOR_MODEL,
  HUNTER_COMPANY_RESEARCH_PROMPT_VERSION,
  HUNTER_COMPANY_RESEARCH_SAFETY,
  HUNTER_COMPANY_RESEARCH_TRANSACTION_TIMEOUT_MS,
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
  it("keeps the hosted research pipeline read-only", () => {
    expect(HUNTER_COMPANY_RESEARCH_DEFAULT_LUNA_MODEL).toBe("gpt-5.6-luna");
    expect(HUNTER_COMPANY_RESEARCH_DEFAULT_QWEN_MODEL).toBe("qwen3.5:35b");
    expect(HUNTER_COMPANY_RESEARCH_DEFAULT_KIMI_MODEL).toBe("kimi-k2.6");
    expect(HUNTER_COMPANY_RESEARCH_DEFAULT_VALIDATOR_MODEL).toBe("kimi-k3");
    expect(HUNTER_COMPANY_RESEARCH_PROMPT_VERSION).toBe("hunter-company-research-v18");
    expect(HUNTER_COMPANY_RESEARCH_TRANSACTION_TIMEOUT_MS).toBe(30_000);
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

  it("does not let incidental China text override a verified North American company identity", () => {
    const company = parseHunterCompanyResearchCompletion(completion()).companies[0];
    const verifiedUsCompany = {
      ...company,
      synthesis: {
        ...company.synthesis,
        companyCountry: "United States",
        operatingRegion: "NORTH_AMERICA" as const,
        verifiedUsDivision: false
      },
      evidence: company.evidence.map((item, index) =>
        index === 0
          ? {
              ...item,
              excerpt:
                "Example Retailer is incorporated in North Carolina. A separate supplier mentioned later is based in China."
            }
          : item
      )
    };

    expect(evaluateResearchGate(verifiedUsCompany).blockers).not.toContain(
      "Mainland-China company has no verified U.S. operating division."
    );
  });

  it("does not require an exact legal division phrase for corroborated North American operators", () => {
    const company = parseHunterCompanyResearchCompletion(completion()).companies[0];
    const silfab = {
      ...company,
      companyName: "SILFAB SOLAR PV SC INC",
      synthesis: {
        ...company.synthesis,
        companyCountry: "United States",
        operatingRegion: "NORTH_AMERICA" as const,
        verifiedUsDivision: true,
        usDivisionName: "Silfab Solar PV SC Inc.",
        usDivisionEvidenceIndices: [0]
      },
      evidence: company.evidence.map((item, index) =>
        index === 0
          ? {
              ...item,
              title: "Silfab Solar - North American-Made Solar Panels",
              excerpt:
                "Silfab Solar operates U.S. manufacturing facilities and makes solar panels exclusively in the USA."
            }
          : item
      )
    };

    expect(evaluateResearchGate(silfab).blockers).not.toContain(
      "The claimed U.S. division is not verified by the cited public identity evidence."
    );
  });

  it("accepts legal-suffix variants but keeps foreign U.S. division evidence explicit", () => {
    const company = parseHunterCompanyResearchCompletion(completion()).companies[0];
    const foreign = {
      ...company,
      companyName: "DNP IMAGINGCOMM AMERICA CORPORATION",
      synthesis: {
        ...company.synthesis,
        companyCountry: "Japan",
        operatingRegion: "OTHER_FOREIGN" as const,
        verifiedUsDivision: true,
        usDivisionName:
          "DNP Imagingcomm America Corporation (U.S. subsidiary of Dai Nippon Printing Co., Ltd.)",
        usDivisionEvidenceIndices: [0]
      },
      evidence: company.evidence.map((item, index) =>
        index === 0
          ? {
              ...item,
              title: "DNP Imagingcomm America",
              excerpt:
                "DNP Imagingcomm America Corporation is a wholly owned U.S. subsidiary operating manufacturing facilities in the United States."
            }
          : item
      )
    };

    expect(evaluateResearchGate(foreign).blockers).not.toContain(
      "The claimed U.S. division is not verified by the cited public identity evidence."
    );

    const unrelated = {
      ...foreign,
      evidence: foreign.evidence.map((item, index) =>
        index === 0
          ? {
              ...item,
              title: "Different Imaging Company",
              excerpt:
                "A different imaging company operates a manufacturing facility in the United States."
            }
          : item
      )
    };
    expect(evaluateResearchGate(unrelated).blockers).toContain(
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

  it("does not let an unrelated similarly named logistics provider block the researched company", () => {
    const company = parseHunterCompanyResearchCompletion(completion()).companies[0];
    const result = evaluateResearchGate({
      ...company,
      companyName: "DNP IMAGINGCOMM AMERICA CORPORATION",
      evidence: [
        ...company.evidence,
        {
          ...company.evidence[0],
          pass: "FOLLOW_UP",
          sourceType: "OTHER",
          firstParty: false,
          title: "DNP Shipping",
          excerpt:
            "DNP Shipping provides freight forwarding, warehousing services, and transportation management."
        }
      ]
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

  it("uses active public registration plus recent exact customs evidence only as an identity fallback", () => {
    const company = parseHunterCompanyResearchCompletion(completion()).companies[0];
    const ambiguous = {
      ...company,
      companyName: "Example Components LLC",
      synthesis: {
        ...company.synthesis,
        identityDisposition: "AMBIGUOUS" as const,
        identityConfidence: 45
      },
      evidence: [
        {
          ...company.evidence[0],
          pass: "IDENTITY" as const,
          sourceType: "GOVERNMENT" as const,
          sourceDomain: "sos.example.gov",
          sourceUrl: "https://sos.example.gov/example-components",
          firstParty: false,
          title: "Example Components LLC registration",
          excerpt: "Example Components LLC is active and in good standing."
        },
        {
          ...company.evidence[1],
          pass: "CUSTOMS_RECORDS" as const,
          sourceType: "OTHER" as const,
          sourceDomain: "customs.example",
          sourceUrl: "https://customs.example/example-components",
          firstParty: false,
          title: "Example Components LLC import record",
          excerpt: "Example Components LLC appeared as consignee.",
          publishedAt: new Date().toISOString()
        }
      ]
    };

    expect(evaluateResearchGate(ambiguous).blockers).not.toContain(
      "Company identity was not confirmed at 70% or better."
    );
    expect(
      evaluateResearchGate({
        ...ambiguous,
        evidence: ambiguous.evidence.map((item, index) =>
          index === 0
            ? { ...item, excerpt: "Example Components LLC is inactive and dissolved." }
            : item
        )
      }).blockers
    ).toContain("Company identity was not confirmed at 70% or better.");
    expect(
      evaluateResearchGate({
        ...ambiguous,
        evidence: ambiguous.evidence.map((item, index) =>
          index === 1
            ? {
                ...item,
                title: "Example Components Holdings import record",
                excerpt: "Example Components Holdings appeared as consignee."
              }
            : item
        )
      }).blockers
    ).toContain("Company identity was not confirmed at 70% or better.");
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
    const [research, worker, runner, serverResearch, shadowResearch] = await Promise.all([
      readFile(researchPath, "utf8"),
      readFile(workerPath, "utf8"),
      readFile(runnerPath, "utf8"),
      readFile(path.join(repoRoot, "src/modules/lead-gen/hunter-company-research.ts"), "utf8"),
      readFile(
        path.join(repoRoot, "src/modules/lead-gen/hunter-company-research-shadow.ts"),
        "utf8"
      )
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
    expect(research).toContain("confidence measures the reliability of the score and identity evidence");
    expect(research).toContain("Do not silently substitute a plausible parent");
    expect(research).toContain("separate customers or member companies");
    expect(research).toContain("parse_brave_published_at");
    expect(research).toContain("parse_page_published_at");
    expect(research).toContain("triggerEvidenceIndices");
    expect(research).toContain("must cite one to five trigger evidence records");
    expect(research).toContain("the material event itself occurred within 18 months");
    expect(research).toContain("/api/lead-gen/hunter/company-research/synthesis");
    expect(research).toContain("submit_luna_primary_batches");
    expect(research).not.toContain("OPENAI_API_KEY");
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
    expect(serverResearch).toContain("tenantCompanies = await tx.company.findMany");
    expect(serverResearch).toContain("timeout: HUNTER_COMPANY_RESEARCH_TRANSACTION_TIMEOUT_MS");
    expect(serverResearch).toContain("company.evidence[company.synthesis.triggerEvidenceIndices[0]]");
    expect(serverResearch).toContain('provider: "OPENAI"');
    expect(serverResearch).toContain("shadowSynthesis:");
    expect(shadowResearch).toContain("authoritative: true");
    expect(shadowResearch).toContain("tenantId");
    expect(shadowResearch).toContain("HUNTER_COMPANY_RESEARCH_LUNA_SHADOW_ENABLED");
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

  it("uses every Luna row as primary synthesis even when Qwen omitted one", async () => {
    const program = [
      "import json",
      "import hunter_company_research as r",
      "requests=[]",
      "def fake_api(_base_url,_token,method,path,payload):",
      " requests.append({'method':method,'path':path,'payload':payload})",
      " rows=[]",
      " for packet in payload['packets']:",
      "  row=dict(synthesis['alpha'])",
      "  row['companyKey']=packet['companyKey']",
      "  rows.append(row)",
      " return {'data':{'state':'completed','rows':rows,'usage':{'inputTokens':100,'cachedInputTokens':10,'outputTokens':20,'totalTokens':120,'durationMs':30},'report':{'status':'SUCCESS','inputTokens':100,'cachedInputTokens':10,'outputTokens':20,'durationMs':30}}}",
      "r.api_request=fake_api",
      "candidates=[{'companyId':'company-1','companyKey':'alpha','companyName':'Alpha','priorityScore':80,'shipmentEvidence':[],'existingSignals':[]},{'companyId':'company-2','companyKey':'beta','companyName':'Beta','priorityScore':70,'shipmentEvidence':[],'existingSignals':[]}]",
      "evidence={key:[{'pass':'IDENTITY','query':key,'title':key,'url':'https://example.com/'+key,'sourceDomain':'example.com','sourceType':'FIRST_PARTY','publishedAt':None,'excerpt':'identity','firstParty':True}] for key in ['alpha','beta']}",
      "synthesis={'alpha':{'identityDisposition':'PASS','identityConfidence':90,'identityReason':'verified','logisticsProvider':False,'namedExternalLogisticsProvider':False,'stableExclusiveProviderEvidence':False,'providerDisplacementEvidence':False,'freshness':'CURRENT','opportunitySummary':'fit','triggerEvidenceIndices':[0],'geography':None,'companyCountry':'United States','operatingRegion':'NORTH_AMERICA','verifiedUsDivision':False,'usDivisionName':None,'usDivisionEvidenceIndices':[],'serviceLine':'WAREHOUSING','signalType':'OTHER','confidence':70,'rationale':'fit','missingEvidence':[],'followUpQueries':[]}}",
      "result=r.submit_luna_primary_batches('https://example.com','token','run-1',{'models':{'synthesis':{'provider':'OPENAI','enabled':True}}},candidates,evidence,synthesis)",
      "print(json.dumps({'result':result,'requests':requests}))"
    ].join("\n");
    const { stdout } = await execFileAsync("python3", ["-c", program], {
      env: {
        ...process.env,
        PYTHONPATH: path.join(repoRoot, "ops/openclaw/hunter"),
        PYTHONPYCACHEPREFIX: "/private/tmp/newl-hunter-company-research-tests"
      }
    });

    const output = JSON.parse(stdout);
    expect(output.requests).toHaveLength(1);
    expect(output.requests[0]).toMatchObject({
      method: "POST",
      path: "/api/lead-gen/hunter/company-research/synthesis",
      payload: {
        runId: "run-1",
        finalBatch: true,
        packets: [
          { companyKey: "alpha", qwenSynthesis: expect.objectContaining({ companyKey: "alpha" }) },
          { companyKey: "beta", qwenSynthesis: null }
        ]
      }
    });
    expect(output.result.synthesisByKey).toEqual({
      alpha: expect.objectContaining({ identityDisposition: "PASS" }),
      beta: expect.objectContaining({ identityDisposition: "PASS" })
    });
  });

  it("isolates malformed Qwen batches and retries affected companies independently", async () => {
    const program = [
      "import json",
      "import hunter_company_research as r",
      "def valid_row(key):",
      " return {'companyKey':key,'identityDisposition':'PASS','identityConfidence':90,'identityReason':'Verified identity.','logisticsProvider':False,'namedExternalLogisticsProvider':False,'stableExclusiveProviderEvidence':False,'providerDisplacementEvidence':False,'freshness':'CURRENT','opportunitySummary':'Current operating footprint.','triggerEvidenceIndices':[0],'geography':'Charlotte, North Carolina','companyCountry':'United States','operatingRegion':'NORTH_AMERICA','verifiedUsDivision':False,'usDivisionName':None,'usDivisionEvidenceIndices':[],'serviceLine':'WAREHOUSING','signalType':'OTHER','confidence':80,'rationale':'Evidence supports current fit.','missingEvidence':[],'followUpQueries':[]}",
      "calls=[]",
      "def fake_request(_url,_model,packets,retry_reason=None):",
      " calls.append({'keys':[packet['companyKey'] for packet in packets],'repair':bool(retry_reason)})",
      " if len(packets)>1: raise RuntimeError('doneReason=length')",
      " return [valid_row(packets[0]['companyKey'])],{'inputTokens':1,'outputTokens':2,'durationMs':3}",
      "r.ollama_synthesis_request=fake_request",
      "candidates=[{'companyKey':'alpha','companyName':'Alpha'},{'companyKey':'beta','companyName':'Beta'}]",
      "evidence={key:[{'pass':'IDENTITY','firstParty':True,'sourceType':'FIRST_PARTY','title':key,'excerpt':'identity','publishedAt':None}] for key in ['alpha','beta']}",
      "results,usage,failures=r.synthesize_companies('http://127.0.0.1:11434','qwen',candidates,evidence,2,2)",
      "print(json.dumps({'keys':sorted(results.keys()),'usage':usage,'failures':failures,'calls':calls}))"
    ].join("\n");
    const { stdout } = await execFileAsync("python3", ["-c", program], {
      env: {
        ...process.env,
        PYTHONPATH: path.join(repoRoot, "ops/openclaw/hunter"),
        PYTHONPYCACHEPREFIX: "/private/tmp/newl-hunter-company-research-tests"
      }
    });

    expect(JSON.parse(stdout)).toEqual({
      keys: ["alpha", "beta"],
      usage: { inputTokens: 2, outputTokens: 4, durationMs: 6 },
      failures: {},
      calls: [
        { keys: ["alpha", "beta"], repair: false },
        { keys: ["alpha"], repair: true },
        { keys: ["beta"], repair: true }
      ]
    });
  });

  it("retains valid Qwen results when one company exhausts its repair attempts", async () => {
    const program = [
      "import json",
      "import hunter_company_research as r",
      "def valid_row(key):",
      " return {'companyKey':key,'identityDisposition':'PASS','identityConfidence':90,'identityReason':'Verified identity.','logisticsProvider':False,'namedExternalLogisticsProvider':False,'stableExclusiveProviderEvidence':False,'providerDisplacementEvidence':False,'freshness':'CURRENT','opportunitySummary':'Current operating footprint.','triggerEvidenceIndices':[0],'geography':'Charlotte, North Carolina','companyCountry':'United States','operatingRegion':'NORTH_AMERICA','verifiedUsDivision':False,'usDivisionName':None,'usDivisionEvidenceIndices':[],'serviceLine':'WAREHOUSING','signalType':'OTHER','confidence':80,'rationale':'Evidence supports current fit.','missingEvidence':[],'followUpQueries':[]}",
      "def fake_request(_url,_model,packets,retry_reason=None):",
      " if len(packets)>1: raise RuntimeError('invalid batch')",
      " key=packets[0]['companyKey']",
      " if key=='beta': raise RuntimeError('missing companies array')",
      " return [valid_row(key)],{'inputTokens':1,'outputTokens':2,'durationMs':3}",
      "r.ollama_synthesis_request=fake_request",
      "candidates=[{'companyKey':'alpha','companyName':'Alpha'},{'companyKey':'beta','companyName':'Beta'}]",
      "evidence={key:[{'pass':'IDENTITY','firstParty':True,'sourceType':'FIRST_PARTY','title':key,'excerpt':'identity','publishedAt':None}] for key in ['alpha','beta']}",
      "results,usage,failures=r.synthesize_companies('http://127.0.0.1:11434','qwen',candidates,evidence,2,1)",
      "print(json.dumps({'keys':sorted(results.keys()),'usage':usage,'failures':failures}))"
    ].join("\n");
    const { stdout } = await execFileAsync("python3", ["-c", program], {
      env: {
        ...process.env,
        PYTHONPATH: path.join(repoRoot, "ops/openclaw/hunter"),
        PYTHONPYCACHEPREFIX: "/private/tmp/newl-hunter-company-research-tests"
      }
    });
    const result = JSON.parse(stdout) as {
      keys: string[];
      usage: { inputTokens: number; outputTokens: number; durationMs: number };
      failures: Record<string, string>;
    };

    expect(result.keys).toEqual(["alpha"]);
    expect(result.usage).toEqual({ inputTokens: 1, outputTokens: 2, durationMs: 3 });
    expect(result.failures.beta).toContain("missing companies array");
  });

  it("creates a private same-day cohort checkpoint path without exposing provider credentials", async () => {
    const program = [
      "import json,os",
      "import hunter_company_research as r",
      "os.environ['HUNTER_PROCESSED_DIRECTORY']='/private/tmp/hunter-processed'",
      "os.environ['HUNTER_COMPANY_RESEARCH_TIMEZONE']='America/Toronto'",
      "path=r.automatic_checkpoint_path([{'companyKey':'alpha'},{'companyKey':'beta'}])",
      "print(json.dumps({'path':path,'containsKey':'secret-key' in path}))"
    ].join(";");
    const { stdout } = await execFileAsync("python3", ["-c", program], {
      env: {
        ...process.env,
        PYTHONPATH: path.join(repoRoot, "ops/openclaw/hunter"),
        PYTHONPYCACHEPREFIX: "/private/tmp/newl-hunter-company-research-tests"
      }
    });
    const result = JSON.parse(stdout) as { path: string; containsKey: boolean };

    expect(result.path).toMatch(
      /^\/private\/tmp\/hunter-processed\/company-research-checkpoints\/\d{4}-\d{2}-\d{2}-[a-f0-9]{16}\.json$/
    );
    expect(result.containsKey).toBe(false);
  });

  it("writes paid-retrieval checkpoints atomically with owner-only permissions", async () => {
    const program = [
      "import json,os,tempfile",
      "import hunter_company_research as r",
      "with tempfile.TemporaryDirectory(dir='/private/tmp') as directory:",
      " path=os.path.join(directory,'nested','checkpoint.json')",
      " r.write_checkpoint(path,{'stage':'RETRIEVAL_COMPLETE','candidateKeys':['alpha']})",
      " mode=oct(os.stat(path).st_mode & 0o777)",
      " print(json.dumps({'mode':mode,'payload':r.read_checkpoint(path),'temporaryExists':os.path.exists(path+'.tmp')}))"
    ].join("\n");
    const { stdout } = await execFileAsync("python3", ["-c", program], {
      env: {
        ...process.env,
        PYTHONPATH: path.join(repoRoot, "ops/openclaw/hunter"),
        PYTHONPYCACHEPREFIX: "/private/tmp/newl-hunter-company-research-tests"
      }
    });

    expect(JSON.parse(stdout)).toEqual({
      mode: "0o600",
      payload: { stage: "RETRIEVAL_COMPLETE", candidateKeys: ["alpha"] },
      temporaryExists: false
    });
  });

  it("recovers fenced Qwen JSON and reports safe truncation diagnostics", async () => {
    const program = [
      "import json",
      "import hunter_company_research as r",
      "class Response:",
      " def __init__(self,payload): self.payload=payload",
      " def __enter__(self): return self",
      " def __exit__(self,*_args): return False",
      " def read(self): return json.dumps(self.payload).encode()",
      "responses=[",
      " {'message':{'content':'```json\\n{\"companies\": []}\\n```'},'done_reason':'stop','prompt_eval_count':1,'eval_count':2},",
      " {'message':{'content':'{\"companies\": ['},'done_reason':'length','prompt_eval_count':1,'eval_count':2},",
      "]",
      "r.urllib.request.urlopen=lambda *_args,**_kwargs: Response(responses.pop(0))",
      "rows,usage=r.ollama_synthesis_request('http://127.0.0.1:11434','qwen',[])",
      "try:",
      " r.ollama_synthesis_request('http://127.0.0.1:11434','qwen',[])",
      "except RuntimeError as error:",
      " diagnostic=str(error)",
      "print(json.dumps({'rows':rows,'usage':usage,'diagnostic':diagnostic}))"
    ].join("\n");
    const { stdout } = await execFileAsync("python3", ["-c", program], {
      env: {
        ...process.env,
        PYTHONPATH: path.join(repoRoot, "ops/openclaw/hunter"),
        PYTHONPYCACHEPREFIX: "/private/tmp/newl-hunter-company-research-tests"
      }
    });
    const result = JSON.parse(stdout) as {
      rows: unknown[];
      usage: { inputTokens: number; outputTokens: number; durationMs: number };
      diagnostic: string;
    };

    expect(result.rows).toEqual([]);
    expect(result.usage.inputTokens).toBe(1);
    expect(result.usage.outputTokens).toBe(2);
    expect(result.diagnostic).toContain("doneReason=length");
    expect(result.diagnostic).toContain("JSON decode failed at line");
    expect(result.diagnostic).not.toContain('"companies"');
  });

  it("builds the bounded company-specific research queries including customs records", async () => {
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
      "CUSTOMS_RECORDS",
      "IDENTITY",
      "FRESH_EVENTS"
    ]);
    expect(rows.slice(0, 4).every((row) => row.query.includes("Example Retailer"))).toBe(true);
    expect(rows.some((row) => row.query.includes("site:example.com"))).toBe(true);
  });

  it("uses same-entity TradeMining aliases only for search and never sends them to model packets", async () => {
    const program = [
      "import json",
      "import hunter_company_research as r",
      "candidate={'companyKey':'example-retailer','companyName':'Example Retailer LLC','priorityScore':80,'queryAliases':['EXAMPLE RETAILER, INC.','Unrelated Supplier Ltd.'],'shipmentEvidence':[],'existingSignals':[]}",
      "queries=r.build_research_queries(candidate)",
      "captured={}",
      "def fake_request(base,model,packets,retry_reason=None):",
      " captured['packets']=packets",
      " return ([{'companyKey':'example-retailer','identityDisposition':'PASS','identityConfidence':90,'identityReason':'Verified.','logisticsProvider':False,'namedExternalLogisticsProvider':False,'stableExclusiveProviderEvidence':False,'providerDisplacementEvidence':False,'freshness':'CURRENT','opportunitySummary':'Current footprint.','triggerEvidenceIndices':[0],'geography':None,'companyCountry':'United States','operatingRegion':'NORTH_AMERICA','verifiedUsDivision':False,'usDivisionName':None,'usDivisionEvidenceIndices':[],'serviceLine':'WAREHOUSING','signalType':'OTHER','confidence':80,'rationale':'Current fit.','missingEvidence':[],'followUpQueries':[]}],{'inputTokens':1,'outputTokens':1,'durationMs':1})",
      "r.ollama_synthesis_request=fake_request",
      "evidence={'example-retailer':[{'pass':'IDENTITY','query':'identity','title':'Example Retailer','url':'https://example.com','sourceDomain':'example.com','sourceType':'FIRST_PARTY','publishedAt':None,'excerpt':'Example Retailer LLC','firstParty':True}]}",
      "r.synthesize_companies('local','qwen',[candidate],evidence,1)",
      "print(json.dumps({'queries':queries,'packets':captured['packets']}))"
    ].join("\n");
    const { stdout } = await execFileAsync("python3", ["-c", program], {
      env: {
        ...process.env,
        PYTHONPATH: path.join(repoRoot, "ops/openclaw/hunter"),
        PYTHONPYCACHEPREFIX: "/private/tmp/newl-hunter-company-research-tests"
      }
    });
    const result = JSON.parse(stdout) as {
      queries: Array<{ query: string }>;
      packets: Array<Record<string, unknown>>;
    };

    expect(result.queries.every((row) => row.query.includes("EXAMPLE RETAILER"))).toBe(true);
    expect(result.queries.every((row) => !row.query.includes("Unrelated Supplier"))).toBe(true);
    expect(JSON.stringify(result.packets)).not.toContain("queryAliases");
    expect(JSON.stringify(result.packets)).not.toContain("Unrelated Supplier");
  });

  it("reserves a page-fetch slot for customs evidence and deduplicates repeated source URLs", async () => {
    const program = [
      "import json",
      "import hunter_company_research as r",
      "candidate={'companyName':'Example Retailer','companyKey':'example-retailer'}",
      "def fake_search(provider,query,limit):",
      " pass_id=next(row['pass'] for row in r.build_research_queries(candidate) if row['query']==query)",
      " url='https://shared.example/evidence' if pass_id in {'IDENTITY','FRESH_EVENTS'} else f'https://{pass_id.lower()}.example/evidence'",
      " return [{'url':url,'title':pass_id,'snippet':'Example Retailer evidence.','publishedAt':'2026-07-01T00:00:00+00:00'}]",
      "fetched=[]",
      "def fake_page(url):",
      " fetched.append(url)",
      " return ('Example Retailer page evidence.','2026-07-01T00:00:00+00:00')",
      "r.search_web=fake_search",
      "r.fetch_page_evidence=fake_page",
      "evidence,_,_=r.collect_company_evidence(candidate,'BRAVE',1,2)",
      "print(json.dumps({'urls':[row['url'] for row in evidence],'fetched':fetched,'passes':[row['pass'] for row in evidence]}))"
    ].join("\n");
    const { stdout } = await execFileAsync("python3", ["-c", program], {
      env: {
        ...process.env,
        PYTHONPATH: path.join(repoRoot, "ops/openclaw/hunter"),
        PYTHONPYCACHEPREFIX: "/private/tmp/newl-hunter-company-research-tests"
      }
    });
    const result = JSON.parse(stdout) as {
      urls: string[];
      fetched: string[];
      passes: string[];
    };

    expect(new Set(result.urls).size).toBe(result.urls.length);
    expect(result.passes).toContain("CUSTOMS_RECORDS");
    expect(result.fetched.some((url) => url.includes("customs_records.example"))).toBe(true);
  });

  it("preserves the Barnhardt first-party expansion query when generic results fill the evidence cap", async () => {
    const program = [
      "import json",
      "import hunter_company_research as r",
      "candidate={'companyName':'BARNHARDT MANUFACTURING CO.','companyKey':'barnhardt-manufacturing-co','domain':'barnhardt.net'}",
      "queries=r.build_research_queries(candidate)",
      "positions={row['query']:index for index,row in enumerate(queries)}",
      "def fake_search(provider,query,limit):",
      " position=positions[query]",
      " host='barnhardt.net' if query.startswith('site:barnhardt.net') else f'source-{position}.example'",
      " rows=[{'url':f'https://{host}/{position}/result-{index}','title':f'Generic result {position}-{index}','snippet':'Generic company evidence.','publishedAt':None} for index in range(limit)]",
      " if query.startswith('site:barnhardt.net') and 'expansion OR' in query:",
      "  rows[0]={'url':'https://barnhardt.net/ncfi-breaks-ground-on-50m-nc-plant-due-to-surging-demand/','title':'NCFI Breaks Ground on $50M+ NC Plant Due to Surging Demand','snippet':'NCFI opened a new 140,000-square-foot manufacturing facility. Barnhardt Manufacturing Company is NCFI parent.','publishedAt':'2025-07-31T00:00:00+00:00'}",
      " return rows",
      "r.search_web=fake_search",
      "r.fetch_page_evidence=lambda url:(None,None)",
      "evidence,query_log,_=r.collect_company_evidence(candidate,'BRAVE',5,0)",
      "target=[row for row in evidence if row['url'].startswith('https://barnhardt.net/ncfi-breaks-ground')]",
      "print(json.dumps({'queryCount':len(query_log),'evidenceCount':len(evidence),'queryEvidenceCounts':[sum(1 for item in evidence if item['query']==row['query']) for row in query_log],'target':target}))"
    ].join("\n");
    const { stdout } = await execFileAsync("python3", ["-c", program], {
      env: {
        ...process.env,
        PYTHONPATH: path.join(repoRoot, "ops/openclaw/hunter"),
        PYTHONPYCACHEPREFIX: "/private/tmp/newl-hunter-company-research-tests"
      }
    });
    const result = JSON.parse(stdout) as {
      queryCount: number;
      evidenceCount: number;
      queryEvidenceCounts: number[];
      target: Array<{ firstParty: boolean; sourceType: string; publishedAt: string }>;
    };

    expect(result).toMatchObject({
      queryCount: 7,
      evidenceCount: 24,
      queryEvidenceCounts: [4, 4, 4, 3, 3, 3, 3]
    });
    expect(result.target).toEqual([
      expect.objectContaining({
        firstParty: true,
        sourceType: "FIRST_PARTY",
        publishedAt: "2025-07-31T00:00:00+00:00"
      })
    ]);
  });

  it("never searches or appends follow-up evidence beyond the company evidence cap", async () => {
    const program = [
      "import json",
      "import hunter_company_research as r",
      "candidate={'companyName':'Example Retailer','companyKey':'example-retailer'}",
      "def evidence(index):",
      " return {'pass':'IDENTITY','query':'identity','title':f'Existing {index}','url':f'https://example.com/existing-{index}','sourceDomain':'example.com','sourceType':'FIRST_PARTY','publishedAt':None,'excerpt':'Existing evidence.','firstParty':True}",
      "calls=[]",
      "def fake_search(provider,query,limit):",
      " calls.append(query)",
      " return [{'url':f'https://news.example/{query}-{index}','title':f'Follow-up {index}','snippet':'New evidence.','publishedAt':None} for index in range(3)]",
      "r.search_web=fake_search",
      "full={'example-retailer':[evidence(index) for index in range(r.MAX_EVIDENCE_PER_COMPANY)]}",
      "full_log=[]",
      "r.collect_follow_up_evidence('BRAVE',[candidate],{'example-retailer':{'followUpQueries':['first','second']}},full,full_log,3,2)",
      "full_result={'calls':len(calls),'evidence':len(full['example-retailer']),'queries':len(full_log)}",
      "calls.clear()",
      "one_slot={'example-retailer':[evidence(index) for index in range(r.MAX_EVIDENCE_PER_COMPANY-1)]}",
      "one_slot_log=[]",
      "r.collect_follow_up_evidence('BRAVE',[candidate],{'example-retailer':{'followUpQueries':['first','second']}},one_slot,one_slot_log,3,2)",
      "bounded=r.bounded_company_evidence([evidence(index) for index in range(r.MAX_EVIDENCE_PER_COMPANY+2)])",
      "print(json.dumps({'full':full_result,'oneSlot':{'calls':len(calls),'evidence':len(one_slot['example-retailer']),'queries':len(one_slot_log)},'bounded':len(bounded)}))"
    ].join("\n");
    const { stdout } = await execFileAsync("python3", ["-c", program], {
      env: {
        ...process.env,
        PYTHONPATH: path.join(repoRoot, "ops/openclaw/hunter"),
        PYTHONPYCACHEPREFIX: "/private/tmp/newl-hunter-company-research-tests"
      }
    });
    const result = JSON.parse(stdout) as {
      full: { calls: number; evidence: number; queries: number };
      oneSlot: { calls: number; evidence: number; queries: number };
      bounded: number;
    };

    expect(result).toEqual({
      full: { calls: 0, evidence: 24, queries: 0 },
      oneSlot: { calls: 1, evidence: 24, queries: 1 },
      bounded: 24
    });
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

  it("pivots from a discovered brand domain to first-party legal identity evidence", async () => {
    const program = [
      "import json",
      "import hunter_company_research as r",
      "candidate={'companyName':'ZOE BABY PRODUCTS, LLC','companyKey':'zoe-baby-products-llc','domain':None}",
      "evidence=[{'pass':'IDENTITY','query':'identity','title':'Zoe Baby social profile','url':'https://www.facebook.com/zoestrollers','sourceDomain':'www.facebook.com','sourceType':'OTHER','publishedAt':None,'excerpt':'ZOE Baby Products, LLC operates zoebaby.com','firstParty':False}]",
      "synthesis={'identityDisposition':'AMBIGUOUS','identityConfidence':45}",
      "calls=[]",
      "def fake_search(provider,query,limit):",
      " calls.append(query)",
      " if query.startswith('site:zoebaby.com'):",
      "  return [{'url':'https://zoebaby.com/pages/privacy-policy','title':'Privacy Policy','snippet':'ZOE Baby Products LLC operates this website from Charlotte, NC.','publishedAt':None}]",
      " return [{'url':'https://zoebaby.com/','title':'Zoe Baby','snippet':'Official stroller company website.','publishedAt':None}]",
      "r.search_web=fake_search",
      "r.fetch_page_evidence=lambda url: (('ZOE Baby Products, LLC operates this website from 4710 Belle Oaks Dr, Charlotte, NC.' if 'privacy' in url else 'Zoe makes lightweight strollers for families.'),None)",
      "by_key={'zoe-baby-products-llc':evidence}",
      "logs=[]",
      "added,pages=r.collect_identity_discovery_evidence('BRAVE',[candidate],{'zoe-baby-products-llc':synthesis},by_key,logs,5)",
      "print(json.dumps({'domains':r.discovered_candidate_domains(candidate,evidence),'calls':calls,'added':added,'pages':pages,'evidence':by_key['zoe-baby-products-llc']}))"
    ].join("\n");
    const { stdout } = await execFileAsync("python3", ["-c", program], {
      env: {
        ...process.env,
        PYTHONPATH: path.join(repoRoot, "ops/openclaw/hunter"),
        PYTHONPYCACHEPREFIX: "/private/tmp/newl-hunter-company-research-tests"
      }
    });
    const result = JSON.parse(stdout) as {
      domains: string[];
      calls: string[];
      added: number;
      pages: number;
      evidence: Array<{
        pass: string;
        sourceDomain: string;
        sourceType: string;
        firstParty: boolean;
        excerpt: string;
      }>;
    };

    expect(result.domains).toEqual(["zoebaby.com"]);
    expect(result.calls).toEqual([
      '"ZOE BABY" official website',
      'site:zoebaby.com ("ZOE BABY PRODUCTS, LLC" OR privacy OR terms OR contact OR about)'
    ]);
    expect(result).toMatchObject({ added: 2, pages: 2 });
    expect(result.evidence).toContainEqual(
      expect.objectContaining({
        pass: "IDENTITY",
        sourceDomain: "zoebaby.com",
        sourceType: "FIRST_PARTY",
        firstParty: true,
        excerpt: expect.stringContaining("Charlotte")
      })
    );
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

  it("preserves an existing-facility production-line expansion that Qwen overlooked", async () => {
    const program = [
      "import datetime as d,json",
      "import hunter_company_research as r",
      "candidate={'companyName':'AALBERTS IPS AMERICAS','companyKey':'aalberts-ips-americas'}",
      "recent=(d.datetime.now(d.timezone.utc)-d.timedelta(days=30)).isoformat()",
      "evidence=[{'pass':'IDENTITY','firstParty':True,'sourceType':'FIRST_PARTY','title':'Aalberts IPS Americas','excerpt':'Aalberts IPS Americas is a US manufacturer.','publishedAt':None},{'pass':'FRESH_EVENTS','firstParty':False,'sourceType':'NEWS','title':'Aalberts brings PowerPress manufacturing to the United States','excerpt':'Aalberts confirms new advanced production lines at its Pageland, South Carolina facility, with phased implementation through 2027, shorter North American lead times, and an ambition to significantly grow its North American business.','publishedAt':recent},{'pass':'DISTRIBUTION_FOOTPRINT','firstParty':True,'sourceType':'FIRST_PARTY','title':'Aalberts IPS website','excerpt':'Integrated piping systems and products.','publishedAt':None}]",
      "synthesis={'identityDisposition':'PASS','identityConfidence':85,'identityReason':'Verified.','confidence':80,'freshness':'CURRENT','triggerEvidenceIndices':[2],'opportunitySummary':'No concrete expansion or investment exists.','signalType':'NEWS','missingEvidence':[],'rationale':'No fresh event selected.','logisticsProvider':False,'stableExclusiveProviderEvidence':False}",
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
      triggerEvidenceIndices: number[];
      opportunitySummary: string;
      signalType: string;
    };

    expect(normalized).toMatchObject({
      freshness: "FRESH",
      triggerEvidenceIndices: [1],
      signalType: "EXPANSION"
    });
    expect(normalized.opportunitySummary).toContain("new advanced production lines");
    expect(normalized.opportunitySummary).not.toContain("No concrete expansion");
  });

  it("does not promote a recently published article about an explicitly historical facility start", async () => {
    const program = [
      "import datetime as d,json",
      "import hunter_company_research as r",
      "candidate={'companyName':'EXAMPLE COMPONENTS INC','companyKey':'example-components-inc'}",
      "recent=(d.datetime.now(d.timezone.utc)-d.timedelta(days=20)).isoformat()",
      "evidence=[{'pass':'IDENTITY','firstParty':True,'sourceType':'FIRST_PARTY','title':'Example Components','excerpt':'Example Components Inc is an active manufacturer.','publishedAt':None},{'pass':'FRESH_EVENTS','firstParty':False,'sourceType':'NEWS','title':'2026 annual report','excerpt':'Example Components began commercial production at its new greenfield facility in 2010.','publishedAt':recent}]",
      "synthesis={'identityDisposition':'PASS','identityConfidence':90,'identityReason':'Verified.','confidence':80,'freshness':'FRESH','triggerEvidenceIndices':[1],'opportunitySummary':'New facility started production.','signalType':'FACILITY_OPENING','missingEvidence':[],'rationale':'Recent article.','logisticsProvider':False,'stableExclusiveProviderEvidence':False}",
      "normalized=r.normalize_synthesis_for_evidence(candidate,evidence,synthesis)",
      "print(json.dumps({'material':r.recent_material_trigger_indices(candidate,evidence),'recent':r.is_recent_trigger(synthesis,evidence),'freshness':normalized['freshness']}))"
    ].join(";");
    const { stdout } = await execFileAsync("python3", ["-c", program], {
      env: {
        ...process.env,
        PYTHONPATH: path.join(repoRoot, "ops/openclaw/hunter"),
        PYTHONPYCACHEPREFIX: "/private/tmp/newl-hunter-company-research-tests"
      }
    });

    expect(JSON.parse(stdout)).toEqual({
      material: [],
      recent: false,
      freshness: "CURRENT"
    });
  });

  it("keeps a recent exact-company event when the same article also provides historical context", async () => {
    const program = [
      "import datetime as d,json",
      "import hunter_company_research as r",
      "candidate={'companyName':'EXAMPLE COMPONENTS INC','companyKey':'example-components-inc'}",
      "recent=(d.datetime.now(d.timezone.utc)-d.timedelta(days=20)).isoformat()",
      "evidence=[{'pass':'FRESH_EVENTS','firstParty':False,'sourceType':'NEWS','title':'Example Components expansion','excerpt':'Example Components began production at its first plant in 2010. Example Components opened a new distribution center in 2026.','publishedAt':recent}]",
      "synthesis={'freshness':'FRESH','triggerEvidenceIndices':[0]}",
      "print(json.dumps({'material':r.recent_material_trigger_indices(candidate,evidence),'recent':r.is_recent_trigger(synthesis,evidence)}))"
    ].join(";");
    const { stdout } = await execFileAsync("python3", ["-c", program], {
      env: {
        ...process.env,
        PYTHONPATH: path.join(repoRoot, "ops/openclaw/hunter"),
        PYTHONPYCACHEPREFIX: "/private/tmp/newl-hunter-company-research-tests"
      }
    });

    expect(JSON.parse(stdout)).toEqual({ material: [0], recent: true });
  });

  it("does not join separate existing-plant and planned-facility clauses into a commencement event", async () => {
    const program = [
      "import datetime as d,json",
      "import hunter_company_research as r",
      "candidate={'companyName':'EXAMPLE COMPONENTS INC','companyKey':'example-components-inc'}",
      "recent=(d.datetime.now(d.timezone.utc)-d.timedelta(days=20)).isoformat()",
      "evidence=[{'pass':'FRESH_EVENTS','sourceType':'NEWS','firstParty':False,'title':'Example Components update','excerpt':'Example Components began operations at its existing plant and separately plans a new greenfield facility.','publishedAt':recent}]",
      "print(json.dumps(r.recent_material_trigger_indices(candidate,evidence)))"
    ].join(";");
    const { stdout } = await execFileAsync("python3", ["-c", program], {
      env: {
        ...process.env,
        PYTHONPATH: path.join(repoRoot, "ops/openclaw/hunter"),
        PYTHONPYCACHEPREFIX: "/private/tmp/newl-hunter-company-research-tests"
      }
    });

    expect(JSON.parse(stdout)).toEqual([]);
  });

  it("uses active exact-name public registration plus recent trade evidence for identity only", async () => {
    const program = [
      "import json",
      "import hunter_company_research as r",
      "candidate={'companyName':'Example Components Inc','companyKey':'example-components-inc'}",
      "good=[{'pass':'IDENTITY','sourceType':'GOVERNMENT','sourceDomain':'sos.example.gov','title':'Example Components Inc','excerpt':'Status Active; registered business.','publishedAt':None},{'pass':'CUSTOMS_RECORDS','sourceType':'OTHER','sourceDomain':'customs.example','title':'Example Components Inc imports','excerpt':'Example Components Inc consignee shipment.','publishedAt':'2026-07-01T00:00:00+00:00'}]",
      "inactive=[dict(good[0],excerpt='Status Dissolved'),good[1]]",
      "similar=[dict(good[0],title='Example Components Holdings Inc',excerpt='Example Components Holdings Inc status Active'),dict(good[1],title='Example Components Holdings Inc imports',excerpt='Example Components Holdings Inc consignee shipment')]",
      "print(json.dumps({'good':r.has_current_public_trade_identity(candidate,good),'inactive':r.has_current_public_trade_identity(candidate,inactive),'similar':r.has_current_public_trade_identity(candidate,similar)}))"
    ].join(";");
    const { stdout } = await execFileAsync("python3", ["-c", program], {
      env: {
        ...process.env,
        PYTHONPATH: path.join(repoRoot, "ops/openclaw/hunter"),
        PYTHONPYCACHEPREFIX: "/private/tmp/newl-hunter-company-research-tests"
      }
    });

    expect(JSON.parse(stdout)).toEqual({
      good: true,
      inactive: false,
      similar: false
    });
  });

  it("prefers Atlas Copco Compressors' distribution center over an affiliate expansion", async () => {
    const program = [
      "import datetime as d,json",
      "import hunter_company_research as r",
      "candidate={'companyName':'ATLAS COPCO COMPRESSORS LLC','companyKey':'atlas-copco-compressors-llc'}",
      "recent=(d.datetime.now(d.timezone.utc)-d.timedelta(days=60)).isoformat()",
      "evidence=[{'pass':'IDENTITY','sourceType':'FIRST_PARTY','firstParty':True,'title':'Atlas Copco Compressors','excerpt':'Atlas Copco Compressors LLC supplies industrial air compressors.','publishedAt':None},{'pass':'CAREERS','sourceType':'CAREERS','firstParty':True,'title':'Careers','excerpt':'Explore jobs.','publishedAt':None},{'pass':'DISTRIBUTION_FOOTPRINT','sourceType':'FIRST_PARTY','firstParty':True,'title':'Locations','excerpt':'Atlas Copco locations.','publishedAt':None},{'pass':'FRESH_EVENTS','sourceType':'NEWS','firstParty':False,'title':'Atlas Copco Comptec expands Voorheesville manufacturing','excerpt':'Atlas Copco Comptec announced a manufacturing expansion at its Voorheesville facility.','publishedAt':recent},{'pass':'FRESH_EVENTS','sourceType':'OTHER','firstParty':False,'title':'Generic result','excerpt':'Atlas Copco products.','publishedAt':recent},{'pass':'CAREERS','sourceType':'CAREERS','firstParty':False,'title':'Jobs','excerpt':'Open roles.','publishedAt':None},{'pass':'DISTRIBUTION_FOOTPRINT','sourceType':'OTHER','firstParty':False,'title':'Footprint','excerpt':'Atlas Copco footprint.','publishedAt':None},{'pass':'FRESH_EVENTS','sourceType':'GOVERNMENT','firstParty':False,'title':'Atlas Copco Compressors establishing Lancaster County distribution center','excerpt':'Atlas Copco Compressors is establishing a 400,000-square-foot air-compressor distribution center with a $51 million first phase and 163 jobs.','publishedAt':recent}]",
      "synthesis={'identityDisposition':'PASS','identityConfidence':90,'identityReason':'Verified.','confidence':88,'freshness':'FRESH','triggerEvidenceIndices':[3],'opportunitySummary':'Atlas Copco Comptec is expanding manufacturing in Voorheesville.','signalType':'EXPANSION','missingEvidence':[],'rationale':'Affiliate expansion selected.','logisticsProvider':False,'stableExclusiveProviderEvidence':False}",
      "material=r.recent_material_trigger_indices(candidate,evidence)",
      "preferred=r.preferred_model_evidence_indices(candidate,evidence,synthesis)",
      "packet=r.select_company_model_evidence(candidate,evidence,synthesis)",
      "normalized=r.normalize_synthesis_for_evidence(candidate,evidence,synthesis)",
      "print(json.dumps({'material':material,'preferred':preferred,'packet':[row['evidenceIndex'] for row in packet],'triggers':normalized['triggerEvidenceIndices'],'summary':normalized['opportunitySummary']}))"
    ].join(";");
    const { stdout } = await execFileAsync("python3", ["-c", program], {
      env: {
        ...process.env,
        PYTHONPATH: path.join(repoRoot, "ops/openclaw/hunter"),
        PYTHONPYCACHEPREFIX: "/private/tmp/newl-hunter-company-research-tests"
      }
    });
    const result = JSON.parse(stdout) as {
      material: number[];
      preferred: number[];
      packet: number[];
      triggers: number[];
      summary: string;
    };

    expect(result).toMatchObject({
      material: [7, 3],
      preferred: [7, 3],
      packet: [7, 3, 0, 1, 2],
      triggers: [7, 3]
    });
    expect(result.summary).toContain("400,000-square-foot air-compressor distribution center");
    expect(result.summary).not.toContain("Voorheesville");
  });

  it("repairs a fresh synthesis that cites the wrong trigger before applying the date gate", async () => {
    const program = [
      "import datetime as d,json",
      "import hunter_company_research as r",
      "candidate={'companyName':'AALBERTS IPS AMERICAS','companyKey':'aalberts-ips-americas'}",
      "recent=(d.datetime.now(d.timezone.utc)-d.timedelta(days=30)).isoformat()",
      "evidence=[{'pass':'IDENTITY','firstParty':True,'sourceType':'FIRST_PARTY','title':'Aalberts IPS Americas','excerpt':'Aalberts IPS Americas is a US manufacturer.','publishedAt':None},{'pass':'FRESH_EVENTS','firstParty':False,'sourceType':'OTHER','title':'Aalberts brings PowerPress manufacturing to the United States','excerpt':'Aalberts announced a major investment that expands production capabilities at its South Carolina facility, increasing manufacturing capacity through 2027. Aalberts IPS Americas operates the facility.','publishedAt':recent},{'pass':'CAREERS','firstParty':True,'sourceType':'CAREERS','title':'Aalberts IPS careers','excerpt':'Current logistics jobs.','publishedAt':None}]",
      "synthesis={'identityDisposition':'PASS','identityConfidence':85,'identityReason':'Verified.','confidence':85,'freshness':'FRESH','triggerEvidenceIndices':[2],'missingEvidence':[],'rationale':'Fresh hiring signal.','logisticsProvider':False,'stableExclusiveProviderEvidence':False}",
      "print(json.dumps(r.normalize_synthesis_for_evidence(candidate,evidence,synthesis)))"
    ].join(";");
    const { stdout } = await execFileAsync("python3", ["-c", program], {
      env: {
        ...process.env,
        PYTHONPATH: path.join(repoRoot, "ops/openclaw/hunter"),
        PYTHONPYCACHEPREFIX: "/private/tmp/newl-hunter-company-research-tests"
      }
    });

    expect(JSON.parse(stdout)).toMatchObject({
      freshness: "FRESH",
      triggerEvidenceIndices: [1]
    });
  });

  it("hands off a current logistics vacancy instead of a footprint or salary page", async () => {
    const program = [
      "import json",
      "import hunter_company_research as r",
      "candidate={'companyName':'EXAMPLE COMPONENTS INC.','companyKey':'example-components-inc'}",
      "evidence=[{'pass':'IDENTITY','sourceType':'FIRST_PARTY','firstParty':True,'title':'Example Components','excerpt':'Example Components is a U.S. manufacturer.','publishedAt':None},{'pass':'DISTRIBUTION_FOOTPRINT','sourceType':'DIRECTORY','firstParty':False,'title':'Example Components footprint','excerpt':'Example Components operates a manufacturing site.','publishedAt':None},{'pass':'CAREERS','sourceType':'CAREERS','firstParty':False,'title':'Warehouse Supervisor Salary in Example City','excerpt':'Example Components Warehouse Supervisor salary records and average annual salary.','publishedAt':None},{'pass':'CAREERS','sourceType':'CAREERS','firstParty':False,'title':'Operations Logistics Manager - Example Components','excerpt':'Example Components is hiring an Operations Logistics Manager. Apply now to manage inbound materials and warehouse operations.','publishedAt':None}]",
      "synthesis={'identityDisposition':'PASS','identityConfidence':90,'identityReason':'Verified.','confidence':82,'freshness':'CURRENT','triggerEvidenceIndices':[1],'opportunitySummary':'The company footprint supports current fit.','signalType':'HIRING','missingEvidence':[],'rationale':'Current operations.','logisticsProvider':False,'stableExclusiveProviderEvidence':False}",
      "vacancies=r.specific_logistics_management_vacancy_indices(candidate,evidence)",
      "preferred=r.preferred_model_evidence_indices(candidate,evidence,synthesis)",
      "normalized=r.normalize_synthesis_for_evidence(candidate,evidence,synthesis)",
      "print(json.dumps({'vacancies':vacancies,'preferred':preferred,'triggers':normalized['triggerEvidenceIndices'],'summary':normalized['opportunitySummary'],'signalType':normalized['signalType']}))"
    ].join(";");
    const { stdout } = await execFileAsync("python3", ["-c", program], {
      env: {
        ...process.env,
        PYTHONPATH: path.join(repoRoot, "ops/openclaw/hunter"),
        PYTHONPYCACHEPREFIX: "/private/tmp/newl-hunter-company-research-tests"
      }
    });

    expect(JSON.parse(stdout)).toEqual({
      vacancies: [3],
      preferred: [3, 1],
      triggers: [3],
      summary:
        "Operations Logistics Manager - Example Components: Example Components is hiring an Operations Logistics Manager. Apply now to manage inbound materials and warehouse operations.",
      signalType: "HIRING"
    });
  });

  it("does not convert salary records or missing vacancy evidence into current openings", async () => {
    const program = [
      "import json",
      "import hunter_company_research as r",
      "candidate={'companyName':'EXAMPLE COMPONENTS INC.','companyKey':'example-components-inc'}",
      "evidence=[{'pass':'IDENTITY','sourceType':'FIRST_PARTY','firstParty':True,'title':'Example Components','excerpt':'Example Components is a U.S. manufacturer.','publishedAt':None},{'pass':'DISTRIBUTION_FOOTPRINT','sourceType':'DIRECTORY','firstParty':False,'title':'Example Components footprint','excerpt':'Example Components operates a manufacturing site.','publishedAt':None},{'pass':'CAREERS','sourceType':'CAREERS','firstParty':False,'title':'Supply Chain Manager Salary in Example City','excerpt':'Example Components Supply Chain Manager salary records and average annual salary.','publishedAt':None}]",
      "synthesis={'identityDisposition':'PASS','identityConfidence':90,'identityReason':'Verified.','confidence':82,'freshness':'CURRENT','triggerEvidenceIndices':[2],'opportunitySummary':'Example Components is hiring a Supply Chain Manager.','signalType':'HIRING','missingEvidence':[],'rationale':'Current hiring.','logisticsProvider':False,'stableExclusiveProviderEvidence':False}",
      "normalized=r.normalize_synthesis_for_evidence(candidate,evidence,synthesis)",
      "missing_evidence=evidence[:2]",
      "missing_synthesis={**synthesis,'triggerEvidenceIndices':[1],'opportunitySummary':'Example Components is hiring a warehouse leader.'}",
      "missing_normalized=r.normalize_synthesis_for_evidence(candidate,missing_evidence,missing_synthesis)",
      "print(json.dumps({'salary':{'vacancies':r.specific_logistics_management_vacancy_indices(candidate,evidence),'triggers':normalized['triggerEvidenceIndices'],'summary':normalized['opportunitySummary'],'signalType':normalized['signalType'],'missingEvidence':normalized['missingEvidence']},'missing':{'vacancies':r.specific_logistics_management_vacancy_indices(candidate,missing_evidence),'triggers':missing_normalized['triggerEvidenceIndices'],'summary':missing_normalized['opportunitySummary'],'signalType':missing_normalized['signalType'],'missingEvidence':missing_normalized['missingEvidence']}}))"
    ].join(";");
    const { stdout } = await execFileAsync("python3", ["-c", program], {
      env: {
        ...process.env,
        PYTHONPATH: path.join(repoRoot, "ops/openclaw/hunter"),
        PYTHONPYCACHEPREFIX: "/private/tmp/newl-hunter-company-research-tests"
      }
    });
    const normalized = JSON.parse(stdout) as {
      salary: {
        vacancies: number[];
        triggers: number[];
        summary: string;
        signalType: string;
        missingEvidence: string[];
      };
      missing: {
        vacancies: number[];
        triggers: number[];
        summary: string;
        signalType: string;
        missingEvidence: string[];
      };
    };

    expect(normalized.salary).toMatchObject({
      vacancies: [],
      triggers: [1],
      signalType: "OTHER"
    });
    expect(normalized.salary.summary).toContain("operates a manufacturing site");
    expect(normalized.salary.summary).not.toContain("salary records");
    expect(normalized.salary.summary).not.toContain("is hiring");
    expect(normalized.salary.missingEvidence).toContain(
      "Hiring wording was removed because the saved evidence did not contain a current exact-company logistics-management vacancy."
    );
    expect(normalized.missing).toMatchObject({
      vacancies: [],
      triggers: [1],
      signalType: "OTHER"
    });
    expect(normalized.missing.summary).toContain("operates a manufacturing site");
    expect(normalized.missing.summary).not.toContain("is hiring");
    expect(normalized.missing.missingEvidence).toContain(
      "Hiring wording was removed because the saved evidence did not contain a current exact-company logistics-management vacancy."
    );
  });

  it("rejects role taxonomies, job descriptions, employee profiles, and generic duties as vacancies", async () => {
    const program = [
      "import json",
      "import hunter_company_research as r",
      "candidate={'companyName':'EXAMPLE COMPONENTS INC.','companyKey':'example-components-inc'}",
      "base=[{'pass':'IDENTITY','sourceType':'FIRST_PARTY','firstParty':True,'title':'Example Components','excerpt':'Example Components is a U.S. manufacturer.','publishedAt':None},{'pass':'DISTRIBUTION_FOOTPRINT','sourceType':'FIRST_PARTY','firstParty':True,'title':'Example Components locations','excerpt':'Example Components operates a manufacturing and distribution site.','publishedAt':None}]",
      "invalid=[{'pass':'CAREERS','sourceType':'CAREERS','firstParty':False,'title':'Warehouse Supervisor Role Taxonomy','excerpt':'Example Components warehouse supervisor role taxonomy with responsibilities and qualifications. Apply now when adapting this reference.','publishedAt':None},{'pass':'CAREERS','sourceType':'CAREERS','firstParty':False,'title':'Supply Chain Manager Job Description','excerpt':'Example Components sample job description lists responsibilities and qualifications. Join our team language is included as a template.','publishedAt':None},{'pass':'CAREERS','sourceType':'CAREERS','firstParty':False,'title':'Employee Profile: Example Person, Logistics Manager','excerpt':'Example Person works at Example Components as Logistics Manager. The employee profile says the team is seeking qualified candidates.','publishedAt':None},{'pass':'CAREERS','sourceType':'CAREERS','firstParty':False,'title':'Distribution Manager responsibilities','excerpt':'Example Components Distribution Manager responsibilities include inventory control. Qualifications include five years of experience.','publishedAt':None}]",
      "results=[]",
      "synthesis={'identityDisposition':'PASS','identityConfidence':90,'identityReason':'Verified.','confidence':82,'freshness':'CURRENT','triggerEvidenceIndices':[2],'opportunitySummary':'Example Components is hiring a logistics manager.','signalType':'HIRING','missingEvidence':[],'rationale':'Current hiring.','logisticsProvider':False,'stableExclusiveProviderEvidence':False}",
      "exec(\"for row in invalid:\\n evidence=base+[row]\\n normalized=r.normalize_synthesis_for_evidence(candidate,evidence,synthesis)\\n results.append({'vacancies':r.specific_logistics_management_vacancy_indices(candidate,evidence),'triggers':normalized['triggerEvidenceIndices'],'summary':normalized['opportunitySummary'],'signalType':normalized['signalType']})\")",
      "print(json.dumps(results))"
    ].join(";");
    const { stdout } = await execFileAsync("python3", ["-c", program], {
      env: {
        ...process.env,
        PYTHONPATH: path.join(repoRoot, "ops/openclaw/hunter"),
        PYTHONPYCACHEPREFIX: "/private/tmp/newl-hunter-company-research-tests"
      }
    });
    const results = JSON.parse(stdout) as Array<{
      vacancies: number[];
      triggers: number[];
      summary: string;
      signalType: string;
    }>;

    expect(results).toHaveLength(4);
    for (const result of results) {
      expect(result).toMatchObject({
        vacancies: [],
        triggers: [1],
        signalType: "OTHER"
      });
      expect(result.summary).toContain("manufacturing and distribution site");
      expect(result.summary).not.toContain("is hiring");
    }
  });

  it("rejects a first-party career path that advertises only future opportunities", async () => {
    const program = [
      "import json",
      "import hunter_company_research as r",
      "candidate={'companyName':'EXAMPLE COMPONENTS INC.','companyKey':'example-components-inc'}",
      "evidence=[{'pass':'IDENTITY','sourceType':'FIRST_PARTY','firstParty':True,'title':'Example Components','excerpt':'Example Components is a U.S. manufacturer.','publishedAt':None},{'pass':'DISTRIBUTION_FOOTPRINT','sourceType':'FIRST_PARTY','firstParty':True,'title':'Example Components locations','excerpt':'Example Components operates a manufacturing and distribution site.','publishedAt':None},{'pass':'CAREERS','sourceType':'CAREERS','firstParty':True,'title':'Warehouse Manager career path | Example Components','excerpt':'Learn how Warehouse Managers grow at Example Components. Join our team and apply for future opportunities.','publishedAt':None}]",
      "synthesis={'identityDisposition':'PASS','identityConfidence':90,'identityReason':'Verified.','confidence':82,'freshness':'CURRENT','triggerEvidenceIndices':[2],'opportunitySummary':'Example Components is hiring a Warehouse Manager.','signalType':'HIRING','missingEvidence':[],'rationale':'Current hiring.','logisticsProvider':False,'stableExclusiveProviderEvidence':False}",
      "normalized=r.normalize_synthesis_for_evidence(candidate,evidence,synthesis)",
      "print(json.dumps({'vacancies':r.specific_logistics_management_vacancy_indices(candidate,evidence),'triggers':normalized['triggerEvidenceIndices'],'summary':normalized['opportunitySummary'],'signalType':normalized['signalType'],'missingEvidence':normalized['missingEvidence']}))"
    ].join(";");
    const { stdout } = await execFileAsync("python3", ["-c", program], {
      env: {
        ...process.env,
        PYTHONPATH: path.join(repoRoot, "ops/openclaw/hunter"),
        PYTHONPYCACHEPREFIX: "/private/tmp/newl-hunter-company-research-tests"
      }
    });

    expect(JSON.parse(stdout)).toEqual({
      vacancies: [],
      triggers: [1],
      summary:
        "Example Components locations: Example Components operates a manufacturing and distribution site.",
      signalType: "OTHER",
      missingEvidence: [
        "Hiring wording was removed because the saved evidence did not contain a current exact-company logistics-management vacancy."
      ]
    });
  });

  it("selects duplicate vacancies deterministically and fails closed on incomplete careers rows", async () => {
    const program = [
      "import json",
      "import hunter_company_research as r",
      "candidate={'companyName':'EXAMPLE COMPONENTS INC.','companyKey':'example-components-inc'}",
      "base=[{'pass':'IDENTITY','sourceType':'FIRST_PARTY','firstParty':True,'title':'Example Components','excerpt':'Example Components is a U.S. manufacturer.','publishedAt':None},{'pass':'DISTRIBUTION_FOOTPRINT','sourceType':'FIRST_PARTY','firstParty':True,'title':'Example Components locations','excerpt':'Example Components operates a distribution site.','publishedAt':None}]",
      "vacancy={'pass':'CAREERS','sourceType':'CAREERS','firstParty':False,'title':'Logistics Operations Manager - Example Components','excerpt':'Example Components is hiring a Logistics Operations Manager. Apply now to lead warehouse operations.','publishedAt':None}",
      "duplicates=base+[vacancy,dict(vacancy)]",
      "incomplete=base+[{'pass':'CAREERS','sourceType':'CAREERS','firstParty':False,'title':'','excerpt':'Example Components is hiring a Warehouse Manager. Apply now.','publishedAt':None},{'pass':'CAREERS','sourceType':'CAREERS','firstParty':False,'title':'Supply Chain Manager - Example Components','excerpt':'','publishedAt':None}]",
      "synthesis={'identityDisposition':'PASS','identityConfidence':90,'identityReason':'Verified.','confidence':82,'freshness':'CURRENT','triggerEvidenceIndices':[2],'opportunitySummary':'Example Components is hiring a logistics manager.','signalType':'HIRING','missingEvidence':[],'rationale':'Current hiring.','logisticsProvider':False,'stableExclusiveProviderEvidence':False}",
      "duplicate_normalized=r.normalize_synthesis_for_evidence(candidate,duplicates,synthesis)",
      "incomplete_normalized=r.normalize_synthesis_for_evidence(candidate,incomplete,synthesis)",
      "print(json.dumps({'duplicateVacancies':r.specific_logistics_management_vacancy_indices(candidate,duplicates),'duplicateTriggers':duplicate_normalized['triggerEvidenceIndices'],'duplicateSummary':duplicate_normalized['opportunitySummary'],'incompleteVacancies':r.specific_logistics_management_vacancy_indices(candidate,incomplete),'incompleteTriggers':incomplete_normalized['triggerEvidenceIndices'],'incompleteSummary':incomplete_normalized['opportunitySummary'],'incompleteSignalType':incomplete_normalized['signalType']}))"
    ].join(";");
    const { stdout } = await execFileAsync("python3", ["-c", program], {
      env: {
        ...process.env,
        PYTHONPATH: path.join(repoRoot, "ops/openclaw/hunter"),
        PYTHONPYCACHEPREFIX: "/private/tmp/newl-hunter-company-research-tests"
      }
    });

    expect(JSON.parse(stdout)).toEqual({
      duplicateVacancies: [2],
      duplicateTriggers: [2],
      duplicateSummary:
        "Logistics Operations Manager - Example Components: Example Components is hiring a Logistics Operations Manager. Apply now to lead warehouse operations.",
      incompleteVacancies: [],
      incompleteTriggers: [1],
      incompleteSummary:
        "Example Components locations: Example Components operates a distribution site.",
      incompleteSignalType: "OTHER"
    });
  });

  it("guarantees reconciled trigger evidence into compact Kimi packets", async () => {
    const program = [
      "import json",
      "import hunter_company_research as r",
      "rows=[{'pass':'IDENTITY','sourceType':'FIRST_PARTY','firstParty':True,'title':'Identity'},{'pass':'FRESH_EVENTS','sourceType':'OTHER','firstParty':False,'title':'Undated vacancies'},{'pass':'FRESH_EVENTS','sourceType':'OTHER','firstParty':False,'title':'Expansion one'},{'pass':'FRESH_EVENTS','sourceType':'OTHER','firstParty':False,'title':'Expansion two'},{'pass':'CAREERS','sourceType':'CAREERS','firstParty':True,'title':'Careers'},{'pass':'DISTRIBUTION_FOOTPRINT','sourceType':'FIRST_PARTY','firstParty':True,'title':'Distribution'}]",
      "print(json.dumps(r.select_model_evidence(rows,preferred_indices=[2,3])))"
    ].join(";");
    const { stdout } = await execFileAsync("python3", ["-c", program], {
      env: {
        ...process.env,
        PYTHONPATH: path.join(repoRoot, "ops/openclaw/hunter"),
        PYTHONPYCACHEPREFIX: "/private/tmp/newl-hunter-company-research-tests"
      }
    });
    const evidence = JSON.parse(stdout) as Array<{
      evidenceIndex: number;
      pass: string;
    }>;

    expect(evidence.map((row) => row.evidenceIndex)).toEqual([2, 3, 0, 4, 5]);
    expect(new Set(evidence.map((row) => row.pass))).toEqual(
      new Set(["IDENTITY", "FRESH_EVENTS", "CAREERS", "DISTRIBUTION_FOOTPRINT"])
    );
  });

  it("rejects synthesis checkpoints created before the production-line repair", async () => {
    const program = [
      "import hunter_company_research as r",
      "checkpoint={'candidateKeys':['aalberts-ips-americas'],'promptVersion':'hunter-company-research-v10'}",
      "candidates=[{'companyKey':'aalberts-ips-americas'}]",
      "try:",
      " r.validate_checkpoint_cohort(checkpoint,candidates)",
      "except RuntimeError as error:",
      " print(str(error))"
    ].join("\n");
    const { stdout } = await execFileAsync("python3", ["-c", program], {
      env: {
        ...process.env,
        PYTHONPATH: path.join(repoRoot, "ops/openclaw/hunter"),
        PYTHONPYCACHEPREFIX: "/private/tmp/newl-hunter-company-research-tests"
      }
    });

    expect(stdout).toContain("different prompt contract");
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

  it("preserves Aalberts' dated production expansion and multi-center logistics role in compact model packets", async () => {
    const program = [
      "import datetime as d,json",
      "import hunter_company_research as r",
      "candidate={'companyName':'AALBERTS IPS AMERICAS','companyKey':'aalberts-ips-americas'}",
      "recent=(d.datetime.now(d.timezone.utc)-d.timedelta(days=30)).isoformat()",
      "evidence=[{'pass':'IDENTITY','sourceType':'FIRST_PARTY','firstParty':True,'title':'Aalberts IPS Americas','excerpt':'Aalberts IPS Americas is a U.S. manufacturer.','publishedAt':None},{'pass':'FRESH_EVENTS','sourceType':'FIRST_PARTY','firstParty':True,'title':'Aalberts products','excerpt':'Current product information for Aalberts IPS Americas.','publishedAt':None},{'pass':'CAREERS','sourceType':'CAREERS','firstParty':True,'title':'Careers at Aalberts','excerpt':'Explore open positions.','publishedAt':None},{'pass':'DISTRIBUTION_FOOTPRINT','sourceType':'FIRST_PARTY','firstParty':True,'title':'Aalberts locations','excerpt':'North American locations.','publishedAt':None},{'pass':'CAREERS','sourceType':'CAREERS','firstParty':True,'title':'Distribution Logistics Manager','excerpt':'Aalberts seeks a logistics manager responsible for multiple distribution centers.','publishedAt':None},{'pass':'FRESH_EVENTS','sourceType':'OTHER','firstParty':False,'title':'Aalberts brings manufacturing to the United States','excerpt':'Aalberts is making an investment to install two advanced production lines at its Pageland facility, with phased work through 2027 to shorten lead times and support significant North American growth ambitions.','publishedAt':recent},{'pass':'FRESH_EVENTS','sourceType':'NEWS','firstParty':False,'title':'Aalberts expands Pageland production','excerpt':'Aalberts announced additional production lines in Pageland as part of its North American production expansion.','publishedAt':recent}]",
      "preferred=r.preferred_model_evidence_indices(candidate,evidence)",
      "packet=r.select_company_model_evidence(candidate,evidence)",
      "synthesis={'identityDisposition':'PASS','identityConfidence':85,'identityReason':'Verified.','confidence':80,'freshness':'CURRENT','triggerEvidenceIndices':[1],'missingEvidence':[],'rationale':'No dated trigger or specific hiring role.','logisticsProvider':False,'stableExclusiveProviderEvidence':False}",
      "normalized=r.normalize_synthesis_for_evidence(candidate,evidence,synthesis)",
      "print(json.dumps({'preferred':preferred,'packet':[row['evidenceIndex'] for row in packet],'freshness':normalized['freshness'],'triggers':normalized['triggerEvidenceIndices']}))"
    ].join(";");
    const { stdout } = await execFileAsync("python3", ["-c", program], {
      env: {
        ...process.env,
        PYTHONPATH: path.join(repoRoot, "ops/openclaw/hunter"),
        PYTHONPYCACHEPREFIX: "/private/tmp/newl-hunter-company-research-tests"
      }
    });

    expect(JSON.parse(stdout)).toEqual({
      preferred: [5, 6, 4],
      packet: [5, 6, 4, 0, 3],
      freshness: "FRESH",
      triggers: [5, 6]
    });
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
        provider: "OPENAI",
        name: "gpt-5.6-luna",
        promptVersion: "hunter-company-research-v18",
        structuredOutput: true,
        inputTokens: 2000,
        cachedInputTokens: 200,
        outputTokens: 700,
        totalTokens: 2700,
        durationMs: 4000,
        estimatedCostUsd: 0.006
      },
      shadowSynthesis: {
        provider: "OLLAMA",
        name: "qwen3.5:35b",
        promptVersion: "hunter-company-research-v18",
        structuredOutput: true,
        enabled: true,
        status: "SUCCESS",
        companyCount: 1,
        failureCount: 0,
        inputTokens: 2000,
        outputTokens: 700,
        durationMs: 4000
      },
      scoring: {
        provider: "KIMI",
        name: "kimi-k2.6",
        promptVersion: "hunter-company-research-v18",
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
        promptVersion: "hunter-company-research-v18",
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
