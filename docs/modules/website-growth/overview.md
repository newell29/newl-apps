# Website Growth and SEO

> Evidence status: implementation details are confirmed from code. Claims, publishing limits, and business outcomes remain human-approved.

## Purpose

Website Growth is Newl's control plane for turning Search Console, GA4, first-party inbound, and manual research into approved website work. It owns evidence, prioritization, the page brief, claim review, approval, and build status. It never merges or publishes the website.

The page-producing role is called **Scout**, not Hunter. Hunter remains a lead-discovery collector. Scout is a separate OpenClaw agent because its inputs, approval boundary, evaluation criteria, and website access are materially different.

## Workflow

```mermaid
flowchart LR
  GSC[Search Console] --> Scout[Scout producer]
  GA4[GA4 landing pages] --> Scout
  Leads[First-party inbound] --> Scout
  Brave[Bounded Brave Search] --> Qwen[Local Qwen triage]
  Qwen --> Scout
  Semrush[Optional SEMrush MCP or cache] --> Scout
  Repo[Website repo context] --> Scout
  Scout --> Brief[Versioned page brief + claim review]
  Brief --> Approval{Owner or manager approves}
  Approval -->|approved| Build[Developer comparison workflow]
  Build --> Codex[Codex primary patch]
  Build --> Kimi[Kimi K3 optional shadow patch]
  Codex --> Checks[Lint + production build]
  Kimi --> Checks
  Checks --> PR[Separate draft PRs + Vercel previews]
  PR --> Merge{Owner merge decision}
  Merge --> Production[Vercel production deployment]
  Production --> Complete[Published / completed]
  Complete --> Monitor[Search Console + GA4 monitoring]
```

Approval of a brief starts the developer workflow automatically. It is not approval to merge. The website repository workflow uses a read-only Codex job to create and verify the primary patch, then a separate job without the OpenAI key pushes the patch and opens a draft PR. When the optional Kimi API key is configured, Kimi K3 receives the same immutable approved brief and starting website commit in a separate read-only-credential job. Its patch must pass the same lint and production-build checks before another credential-separated job may open a comparison draft PR.

A deterministic local notifier sends the owner a fixed-target Teams update when the primary build is dispatched, when its Vercel Preview is ready, or when it fails. Newl Apps owns the tenant-scoped event and message text; OpenClaw only delivers and acknowledges it. The notifier cannot merge or deploy and ignores historical builds created before notification version 1.

After the owner merges the primary Codex PR, Newl Apps marks the brief and opportunity as published only when Vercel reports a successful production deployment for that merged `codex/website-growth-*` branch. The authenticated callback is tenant scoped, idempotent, and cannot merge or deploy the website.

When Scout has stored more than one brief for the same opportunity, the opportunity-level published status closes every duplicate brief in the curated workspace so an older version cannot remain under `Approved and building`.

## Control-plane views

The Website Growth UI intentionally separates two different kinds of records:

- **Scout workspace** is the default view. It contains only AI-curated Scout briefs and groups them into `Needs your review`, `Approved and building`, `Preview ready`, and `Completed and closed`.
- **Research signals** contains the full GA4, Search Console, Semrush, and first-party evidence inventory. These records are inputs to Scout, not a human work queue.
- **Backlink Scout** contains only Codex-reviewed, deduplicated prospects that pass deterministic relevance, quality, and spam-risk gates. Raw public-web results, Qwen rejections, and raw Semrush rows are retained only in tenant-scoped automation history and are never presented as a work queue.

Every Scout card must state whether it proposes a **new page** or an **update to an existing page**, show the affected route, and summarize the primary proposed change. A draft created by the latest Scout run is labeled as new. The latest run summary remains visible even when no opportunities were selected.

## Customer-question and AI-answer lane

Search Console questions are classified into definition, process, cost, comparison, selection, and capability intents. The weekly planner reserves up to two shortlist positions for these question-led candidates, and the bounded Scout packet reserves up to two of its configured candidate slots so higher-scoring generic signals cannot permanently crowd them out.

Scout must map each question to the strongest existing Newl service, location, industry, freight, or resource page before proposing a new URL. The default recommendation is a concise answer-first section with useful operational detail, relevant internal links, and a conversion path. A dedicated guide is allowed only when the intent is substantial and distinct. Thin FAQ pages, keyword-swapped duplicates, hidden or unsupported structured data, and guarantees of AI citations or rankings are prohibited.

This lane improves answer clarity and citation readiness; it does not claim to measure or guarantee inclusion in ChatGPT, Google AI Overviews, Perplexity, or another answer engine. Teams reports state how many question-led candidates were reviewed and promoted.

## Model routing

| Work | Default | Reasoning | Notes |
| --- | --- | --- | --- |
| Imports, scoring, clustering, state checks | Deterministic code | N/A | No model should perform exact comparisons or status changes. |
| Public-web backlink triage | Local Qwen `qwen3.5:35b` | Deterministic structured output | Monday and Wednesday deep runs only. Qwen is advisory and sees only bounded search snippets and at most 40 safely downloaded pages per run. |
| Scout research, final backlink review, and page brief | Codex `gpt-5.6-sol` | `high` | Monday and Wednesday deep runs only. Search Console, GA4, forms, and the website repository remain primary; SEMrush is optional supporting evidence. |
| Approved backlink executor | Dedicated Scout agent with OpenAI `gpt-5.4-mini` | `high` | Weekday tool orchestration only. This model is used because the current OpenClaw Codex `gpt-5.6-sol` harness lists plugin tools but does not invoke them. Scout receives only the browser and dedicated backlink tools; Newl Apps enforces approval, compliance, suppression, volume limits, idempotency, and tenant scope before every external action. |
| Website developer | Codex `gpt-5.6-sol` | `high` | Runs only after approval, in the website repo, with tests and a draft PR. |
| Kimi K3 `kimi-k3` | Optional shadow challenger | `high` | Runs only after brief approval, creates a separate verified patch and draft PR, and never replaces the primary Newl Apps build record. |

Model changes must be evaluated against the same saved opportunities. Compare factuality, claim violations, duplicated intent, route correctness, design fit, lint/build success, reviewer edits, latency, and cost. Do not choose a model from benchmark scores alone.

## Data sources

- Search Console: query/page clicks, impressions, CTR, and position, including deterministic classification of customer-question queries.
- GA4 Data API: landing page sessions, engaged sessions, engagement rate, and event count for the last 28 days.
- Newl inbound: form submissions and lead-producing pages. These remain the source of truth for lead counts.
- SEMrush: official read-only MCP through OAuth for rankings, keyword gaps, competitors, intent, volume, and difficulty. Results are capped and cached as sanitized evidence.
- Manual CSV/TSV: historical Search Console, GA4, Semrush, or one-off research.
- Website repository context: routes, templates, components, navigation, sitemap, and current content.
- Durable design and decision memory: the versioned Newl page-pattern library, current repository inventory (including forms, heroes, CTAs, FAQs, and internal links), and up to 50 recent approved, rejected, built, or published brief decisions.

Existing non-final opportunities are refreshed when matching evidence is re-imported. Approved, in-progress, published, and rejected records are not silently rewritten.

## Claims policy

- Capability descriptions are allowed when supported by the current website/repository context.
- Numerical performance claims need a definition, source, reporting period, sample, owner, and next review date.
- Certifications and affiliations need current documentary evidence and an expiry/review date.
- Customer names, logos, testimonials, case studies, and volumes need explicit permission.
- Absolute and guarantee language is blocked; human approval does not make an unbounded claim safe.
- Public metrics currently visible on the website, including inventory/order accuracy and dock-to-stock timing, should be treated as requiring owner confirmation until their internal source and reporting period are attached.

The initial repository research and evidence requests are recorded in `claims-register.md`.

## Capacity and cost controls

The developer run belongs in GitHub Actions rather than a Vercel function. Vercel serves the control plane and previews, while repository checkout, agent execution, lint, and production build run in GitHub. A successful comparison creates two Preview deployments per approved build request. They may queue when the Vercel account has one concurrent build slot, but neither preview is a production deployment. Weekly publish guides remain two core pages, four supporting items, and six quick optimizations; they are queue limits, not automatic publishing targets.

At 9:15 AM `America/Toronto`, Monday and Wednesday run bounded Brave Search, local Qwen triage, and the read-only Codex Scout; Tuesday, Thursday, and Friday run a deterministic check-in that refreshes Search Console, GA4, forms, and queue state while reusing any stored SEMrush snapshot. Lightweight check-ins spend no Codex tokens, Brave queries, or SEMrush API units. Every trigger still sends a Teams outcome.

When SEMrush API units are available, a deep read-only session refreshes the Newl Group Position Tracking snapshot and stores it with an eight-day expiry. The Wednesday run reuses a still-fresh Monday snapshot instead of spending units again. Deterministic Newl Apps code selects primary and supporting keywords only from human-approved, built, or published Scout briefs, deduplicates them against the tracked-keyword list, and creates a two-column SEMrush import workbook without a separate keyword approval step. Broad competitor-gap discovery remains monthly and optional.

Each deep-run backlink funnel rotates through one of four 12-query plans. Each query returns at most 10 results; deterministic code accepts at most 120 rows, 60 unique domains, 40 full-page downloads, and two downloads per domain per run. Every canonical URL hash is written to the tenant-scoped Scout job ledger before Qwen runs. URLs seen in any prior Scout run or already promoted to the backlink queue are counted as duplicates and never downloaded or added again. Qwen returns at most 15 finalists; Codex may promote at most five. There is no recursive crawl. Newl Apps then applies its existing minimum relevance/quality score of 60, high-spam rejection, referring-domain/target-page dedupe, 50-item active-queue cap, and 45-day stale-review archive.

Backlink approval is distinct from content approval and spending approval. Admin or Manager may approve an opportunity for execution. A dedicated executor token can claim approved free work and report submitted, contacted, blocked, live, or lost states. Paid placements are excluded from machine claims and never authorize a purchase or paid ranking link.

The dedicated weekday outreach job is installed disabled. Once the supervised launch test passes, it runs at 11:00 AM `America/Toronto`, sends at most five new contacts per rolling day and 20 per rolling week, follows up on days 5 and 12, closes after day 21, and sends a Teams update even when there is no approved work. See `backlink-outreach-rollout.md`.

Each executor cycle records its own sanitized run summary. Teams and the Newl Apps workspace distinguish blockers created in the latest run from the unresolved lifetime blocker total. Blocked records are classified deterministically as Technical, Needs owner confirmation, Manual setup, or No contact method and show the recorded reason, recommended next action, and whether a retry will help.

Free directory accounts use `partnerships@newlgroup.com`. Magic links, Microsoft sign-in, and publisher-managed password setup are preferred. Newl Apps may store the public login URL and username but never a password. CAPTCHA, MFA, phone verification, and password creation without an approved password-manager path remain manual setup blockers; they are not bypassed or repeatedly retried.

The existing Vercel weekly planner remains a safe queue-preparation fallback; it does not run Codex or send Teams.

## Human boundaries

- Admin or Manager may approve a brief and start a build.
- Sales and Operations may prepare and review opportunities but may not approve developer or publishing states.
- Codex and Kimi may produce only isolated website patches for the approved build request; credential-separated jobs create their draft branches.
- Vercel Preview is required for visual review. When Kimi is enabled, reviewers compare both previews; Newl Apps continues to track Codex as the primary build during the trial.
- The owner decides whether to merge. Production deployment is never initiated by Newl Apps or Scout.
