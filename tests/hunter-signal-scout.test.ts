import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

import {
  HUNTER_SIGNAL_SCOUT_DEFAULT_MODEL,
  HUNTER_SIGNAL_SCOUT_PROMPT_VERSION,
  HUNTER_SIGNAL_SCOUT_SAFETY,
  parseHunterSignalScoutCompletion
} from "@/modules/lead-gen/hunter-signal-scout";

const execFileAsync = promisify(execFile);
const repoRoot = process.cwd();
const workerPath = path.join(repoRoot, "ops/openclaw/hunter/hunter_worker.py");
const scoutPath = path.join(repoRoot, "ops/openclaw/hunter/hunter_signal_scout.py");
const runnerPath = path.join(repoRoot, "ops/openclaw/run-hunter-worker.sh");

describe("Hunter external signal scout", () => {
  it("uses the installed local instruct model and retains all external-write gates", () => {
    expect(HUNTER_SIGNAL_SCOUT_DEFAULT_MODEL).toBe("qwen3:30b-instruct");
    expect(HUNTER_SIGNAL_SCOUT_PROMPT_VERSION).toBe("hunter-signal-classifier-v1");
    expect(HUNTER_SIGNAL_SCOUT_SAFETY).toEqual({
      externalWrites: false,
      apollo: false,
      outreach: false,
      cadenceWrites: false
    });
  });

  it("accepts a bounded structured classification", () => {
    const parsed = parseHunterSignalScoutCompletion(completion());

    expect(parsed.model).toEqual({
      provider: "OLLAMA",
      name: "qwen3:30b-instruct",
      promptVersion: "hunter-signal-classifier-v1",
      structuredOutput: true
    });
    expect(parsed.candidates[0]).toMatchObject({
      relevant: true,
      companyName: "Example Retailer",
      serviceLine: "WAREHOUSING",
      signalType: "RETAIL_ROLLOUT",
      confidence: 84
    });
  });

  it("rejects unsafe source URLs and incomplete relevant-company classifications", () => {
    const unsafe = completion();
    unsafe.candidates[0].sourceUrl = "http://example.com/news";
    expect(() => parseHunterSignalScoutCompletion(unsafe)).toThrow(/must use HTTPS/);

    const missingCompany = completion();
    missingCompany.candidates[0].companyName = "";
    expect(() => parseHunterSignalScoutCompletion(missingCompany)).toThrow(
      /companyName must be a non-empty string/
    );
  });

  it("keeps the live runner local-only and schedules the scout in the existing Hunter service", async () => {
    const [worker, scout, runner] = await Promise.all([
      readFile(workerPath, "utf8"),
      readFile(scoutPath, "utf8"),
      readFile(runnerPath, "utf8")
    ]);

    expect(worker).toContain("signal_scout_due_now");
    expect(worker).toContain('HUNTER_SIGNAL_SCOUT_DAILY_TIME", "08:30"');
    expect(worker).toContain("run_signal_scout");
    expect(scout).toContain("http://127.0.0.1:11434");
    expect(scout).toContain("qwen3:30b-instruct");
    expect(scout).toContain('"format": CLASSIFICATION_SCHEMA');
    expect(scout).toContain('"WAREHOUSING": 24');
    expect(scout).toContain('"OCEAN_AIR": 12');
    expect(scout).toContain('"TRUCKING": 4');
    expect(scout).not.toContain("api.apollo.io");
    expect(runner).toContain("HUNTER_CLASSIFICATION_MODEL");
    expect(runner).toContain("HUNTER_OLLAMA_BASE_URL");
  });

  it("passes Python and zsh syntax validation", async () => {
    await expect(
      execFileAsync("python3", ["-m", "py_compile", workerPath, scoutPath], {
        env: {
          ...process.env,
          PYTHONPYCACHEPREFIX: "/private/tmp/newl-hunter-signal-scout-tests"
        }
      })
    ).resolves.toBeDefined();
    await expect(execFileAsync("/bin/zsh", ["-n", runnerPath])).resolves.toBeDefined();
  });

  it("bounds discovery itself to the 60/30/10 service mix", async () => {
    const program = [
      "import json",
      "import hunter_signal_scout as s",
      "s.fetch_gdelt_lens=lambda endpoint,lens,lookback,limit: ([{'sourceUrl':f\"https://example.com/{lens['serviceLine'].lower()}/{i}\",'articleTitle':f\"{lens['serviceLine']} event {i}\",'sourceName':'Example','sourcePublishedAt':'2026-07-25T12:00:00+00:00','queryId':lens['id'],'serviceHint':lens['serviceLine'],'sourceCountry':'United States'} for i in range(limit)],None)",
      "packet={'discovery':{'gdeltEndpoint':'https://api.gdeltproject.org/api/v2/doc/doc','googleNewsEndpoint':'https://news.google.com/rss/search','lookbackHours':36,'maxArticles':40,'maxArticlesByService':{'WAREHOUSING':24,'OCEAN_AIR':12,'TRUCKING':4},'lenses':[{'id':'w','serviceLine':'WAREHOUSING','query':'w'},{'id':'o','serviceLine':'OCEAN_AIR','query':'o'},{'id':'t','serviceLine':'TRUCKING','query':'t'}]},'existingSourceUrls':[]}",
      "articles,_=s.collect_articles(packet)",
      "print(json.dumps({line:sum(1 for article in articles if article['serviceHint']==line) for line in ['WAREHOUSING','OCEAN_AIR','TRUCKING']}))"
    ].join(";");
    const { stdout } = await execFileAsync("python3", ["-c", program], {
      env: {
        ...process.env,
        PYTHONPATH: path.join(repoRoot, "ops/openclaw/hunter"),
        PYTHONPYCACHEPREFIX: "/private/tmp/newl-hunter-signal-scout-tests"
      }
    });

    expect(JSON.parse(stdout)).toEqual({
      WAREHOUSING: 24,
      OCEAN_AIR: 12,
      TRUCKING: 4
    });
  });
});

function completion() {
  return {
    model: {
      provider: "OLLAMA",
      name: "qwen3:30b-instruct",
      promptVersion: "hunter-signal-classifier-v1",
      structuredOutput: true
    },
    discovery: {
      provider: "MULTI_SOURCE_NEWS",
      lookbackHours: 36,
      fetchedAt: "2026-07-25T14:00:00.000Z",
      queries: [{ id: "retail-rollout", provider: "GOOGLE_NEWS_RSS", resultCount: 1, error: null }]
    },
    candidates: [
      {
        sourceIndex: 0,
        sourceUrl: "https://example.com/news",
        sourceName: "Example News",
        sourcePublishedAt: "2026-07-25T12:00:00.000Z",
        articleTitle: "Example Retailer to open 20 stores in North Carolina",
        queryId: "retail-rollout",
        relevant: true,
        companyName: "Example Retailer",
        signalType: "RETAIL_ROLLOUT",
        serviceLine: "WAREHOUSING",
        opportunityTitle: "North Carolina store rollout",
        summary: "The retailer announced 20 North Carolina store openings.",
        geography: "North Carolina",
        confidence: 84,
        rationale: "A multi-store rollout can create regional inventory and replenishment demand.",
        evidence: ["20 stores", "North Carolina"]
      }
    ]
  };
}
