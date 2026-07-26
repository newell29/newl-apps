import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import {
  HUNTER_COMPANY_RESEARCH_DEFAULT_KIMI_MODEL,
  HUNTER_COMPANY_RESEARCH_DEFAULT_QWEN_MODEL,
  HUNTER_COMPANY_RESEARCH_PROMPT_VERSION,
  HUNTER_COMPANY_RESEARCH_SAFETY,
  evaluateResearchGate,
  parseHunterCompanyResearchCompletion
} from "@/modules/lead-gen/hunter-company-research";

const execFileAsync = promisify(execFile);
const repoRoot = process.cwd();
const researchPath = path.join(repoRoot, "ops/openclaw/hunter/hunter_company_research.py");
const workerPath = path.join(repoRoot, "ops/openclaw/hunter/hunter_worker.py");
const runnerPath = path.join(repoRoot, "ops/openclaw/run-hunter-worker.sh");

describe("Hunter company deep research", () => {
  it("keeps the two-model pipeline dry-run only", () => {
    expect(HUNTER_COMPANY_RESEARCH_DEFAULT_QWEN_MODEL).toBe("qwen3.5:35b");
    expect(HUNTER_COMPANY_RESEARCH_DEFAULT_KIMI_MODEL).toBe("kimi-k2.6");
    expect(HUNTER_COMPANY_RESEARCH_PROMPT_VERSION).toBe("hunter-company-research-v6");
    expect(HUNTER_COMPANY_RESEARCH_SAFETY).toEqual({
      externalWrites: false,
      apollo: false,
      outreach: false,
      cadenceWrites: false,
      pipelineStageChanges: false
    });
  });

  it("accepts an evidence-backed two-model completion", () => {
    const parsed = parseHunterCompanyResearchCompletion(completion());

    expect(parsed.companies[0].scoring.totalScore).toBe(70);
    expect(evaluateResearchGate(parsed.companies[0])).toEqual({
      passed: true,
      blockers: []
    });
  });

  it("blocks ambiguous identities, logistics providers, stable exclusive providers, and thin evidence", () => {
    const parsed = parseHunterCompanyResearchCompletion(completion());
    const company = parsed.companies[0];

    expect(
      evaluateResearchGate({
        ...company,
        synthesis: { ...company.synthesis, identityDisposition: "AMBIGUOUS" }
      }).passed
    ).toBe(false);
    expect(
      evaluateResearchGate({
        ...company,
        synthesis: { ...company.synthesis, logisticsProvider: true }
      }).blockers
    ).toContain("The company is itself a logistics provider.");
    expect(
      evaluateResearchGate({
        ...company,
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

  it("blocks fresh claims whose event evidence is missing a recent publication date", () => {
    const company = parseHunterCompanyResearchCompletion(completion()).companies[0];
    const result = evaluateResearchGate({
      ...company,
      evidence: company.evidence.map((item) =>
        item.pass === "FRESH_EVENTS"
          ? { ...item, publishedAt: "2010-02-10T00:00:00.000Z" }
          : item
      )
    });

    expect(result.blockers).toContain(
      "The fresh opportunity claim has no verifiable event date within the last 18 months."
    );
  });

  it("rejects forged domains and model arithmetic", () => {
    const forged = completion();
    forged.companies[0].evidence[0].sourceDomain = "different.example";
    expect(() => parseHunterCompanyResearchCompletion(forged)).toThrow(/must match the evidence URL hostname/);

    const badTotal = completion();
    badTotal.companies[0].scoring.totalScore = 99;
    expect(() => parseHunterCompanyResearchCompletion(badTotal)).toThrow(/must equal the five deterministic/);
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
      "DISTRIBUTION_FOOTPRINT"
    ]);
    expect(rows.every((row) => row.query.includes("Example Retailer"))).toBe(true);
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
});

function completion() {
  return {
    models: {
      synthesis: {
        provider: "OLLAMA",
        name: "qwen3.5:35b",
        promptVersion: "hunter-company-research-v6",
        structuredOutput: true,
        inputTokens: 2000,
        outputTokens: 700,
        durationMs: 4000
      },
      scoring: {
        provider: "KIMI",
        name: "kimi-k2.6",
        promptVersion: "hunter-company-research-v6",
        structuredOutput: true,
        inputTokens: 1800,
        cachedInputTokens: 200,
        outputTokens: 500,
        durationMs: 3000,
        estimatedCostUsd: 0.003
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
        }
      }
    ]
  };
}
