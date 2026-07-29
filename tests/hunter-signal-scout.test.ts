import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

import {
  createHunterSignalEventDedupeKey,
  HUNTER_SIGNAL_SCOUT_DEFAULT_MODEL,
  HUNTER_SIGNAL_SCOUT_PROMPT_VERSION,
  HUNTER_SIGNAL_SCOUT_SAFETY,
  parseHunterSignalScoutCompletion,
  selectHunterSignalDiscoveryLenses
} from "@/modules/lead-gen/hunter-signal-scout";

const execFileAsync = promisify(execFile);
const repoRoot = process.cwd();
const workerPath = path.join(repoRoot, "ops/openclaw/hunter/hunter_worker.py");
const scoutPath = path.join(repoRoot, "ops/openclaw/hunter/hunter_signal_scout.py");
const runnerPath = path.join(repoRoot, "ops/openclaw/run-hunter-worker.sh");

describe("Hunter external signal scout", () => {
  it("uses the installed local instruct model and retains all external-write gates", () => {
    expect(HUNTER_SIGNAL_SCOUT_DEFAULT_MODEL).toBe("qwen3:30b-instruct");
    expect(HUNTER_SIGNAL_SCOUT_PROMPT_VERSION).toBe("hunter-signal-classifier-v3");
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
      promptVersion: "hunter-signal-classifier-v3",
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
    expect(worker).toContain("run_signal_scout_with_notification");
    expect(scout).toContain("http://127.0.0.1:11434");
    expect(scout).toContain("qwen3:30b-instruct");
    expect(scout).toContain("HUNTER_BRAVE_SEARCH_API_KEY");
    expect(scout).toContain("https://api.search.brave.com/res/v1/web/search");
    expect(scout).toContain('"format": CLASSIFICATION_SCHEMA');
    expect(scout).toContain('"WAREHOUSING": 24');
    expect(scout).toContain('"OCEAN_AIR": 12');
    expect(scout).toContain('"TRUCKING": 4');
    expect(scout).toContain("Also reject listicles, rankings, directories");
    expect(scout).toContain("Reject one-off pop-ups");
    expect(scout).toContain("OCEAN_AIR requires an");
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
      "s.fetch_brave_lens=lambda endpoint,lens,freshness,limit: ([{'sourceUrl':f\"https://example.com/{lens['serviceLine'].lower()}/{i}\",'articleTitle':f\"{lens['serviceLine']} event {i}\",'articleSnippet':'concrete expansion','sourceName':'Example','sourcePublishedAt':'2026-07-25T12:00:00+00:00','queryId':lens['id'],'serviceHint':lens['serviceLine'],'sourceCountry':'United States'} for i in range(limit)],None)",
      "packet={'discovery':{'braveEndpoint':'https://api.search.brave.com/res/v1/web/search','googleNewsEndpoint':'https://news.google.com/rss/search','freshness':'pm','lookbackHours':744,'maxArticles':40,'maxArticlesByService':{'WAREHOUSING':24,'OCEAN_AIR':12,'TRUCKING':4},'lenses':[{'id':'w','serviceLine':'WAREHOUSING','query':'w'},{'id':'o','serviceLine':'OCEAN_AIR','query':'o'},{'id':'t','serviceLine':'TRUCKING','query':'t'}]},'existingSourceUrls':[]}",
      "articles,_,_=s.collect_articles(packet)",
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

  it("filters obvious directories and warehouse roundups before Qwen", async () => {
    const program = [
      "import json",
      "import hunter_signal_scout as s",
      "titles=['Largest Warehouses in North America','Warehousing Companies in Toronto - 2026 Reviews','Company opens largest distribution center in Ontario']",
      "print(json.dumps([s.is_obvious_non_event_article({'articleTitle':title}) for title in titles]))"
    ].join(";");
    const { stdout } = await execFileAsync("python3", ["-c", program], {
      env: {
        ...process.env,
        PYTHONPATH: path.join(repoRoot, "ops/openclaw/hunter"),
        PYTHONPYCACHEPREFIX: "/private/tmp/newl-hunter-signal-scout-tests"
      }
    });

    expect(JSON.parse(stdout)).toEqual([true, true, false]);
  });

  it("rotates approved topic and geography queries instead of repeating the same set daily", () => {
    const firstDay = selectHunterSignalDiscoveryLenses("2026-07-28");
    const secondDay = selectHunterSignalDiscoveryLenses("2026-07-29");
    const firstQueries = new Set(firstDay.map((lens) => lens.query));

    expect(firstDay).toHaveLength(7);
    expect(firstDay.filter((lens) => lens.serviceLine === "WAREHOUSING")).toHaveLength(4);
    expect(firstDay.filter((lens) => lens.serviceLine === "OCEAN_AIR")).toHaveLength(2);
    expect(firstDay.filter((lens) => lens.serviceLine === "TRUCKING")).toHaveLength(1);
    expect(secondDay.some((lens) => !firstQueries.has(lens.query))).toBe(true);
    expect(firstDay.every((lens) => lens.query.includes("-3PL"))).toBe(true);
  });

  it("groups repeat coverage of the same company event while allowing a later monthly event", () => {
    const first = createHunterSignalEventDedupeKey({
      companyName: "Example Retailer, Inc.",
      signalType: "RETAIL_ROLLOUT",
      geography: "North Carolina",
      sourcePublishedAt: "2026-07-04T12:00:00.000Z",
      fetchedAt: "2026-07-05T12:00:00.000Z"
    });
    const syndicated = createHunterSignalEventDedupeKey({
      companyName: "Example Retailer Inc",
      signalType: "RETAIL_ROLLOUT",
      geography: "North Carolina",
      sourcePublishedAt: "2026-07-06T12:00:00.000Z",
      fetchedAt: "2026-07-06T12:00:00.000Z"
    });
    const later = createHunterSignalEventDedupeKey({
      companyName: "Example Retailer Inc",
      signalType: "RETAIL_ROLLOUT",
      geography: "North Carolina",
      sourcePublishedAt: "2026-08-06T12:00:00.000Z",
      fetchedAt: "2026-08-06T12:00:00.000Z"
    });

    expect(syndicated).toBe(first);
    expect(later).not.toBe(first);
  });
});

function completion() {
  return {
    model: {
      provider: "OLLAMA",
      name: "qwen3:30b-instruct",
      promptVersion: "hunter-signal-classifier-v3",
      structuredOutput: true
    },
    discovery: {
      provider: "BRAVE_WEB",
      lookbackHours: 744,
      fetchedAt: "2026-07-25T14:00:00.000Z",
      rawResultCount: 1,
      duplicateUrlCount: 0,
      filteredNonEventCount: 0,
      selectedArticleCount: 1,
      queries: [{ id: "retail-rollout", provider: "BRAVE_WEB", resultCount: 1, error: null }]
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
