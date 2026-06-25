# Product Operating Brief

This file is the high-level product direction for Newl Apps so future Codex PRs have enough context to make practical implementation decisions without repeatedly re-establishing product intent.

## 1. Current Product Priority

- Build Newl Apps as an internal Newl Group platform first.
- Do not overbuild external SaaS/customer features right now.
- Keep code modular and tenant-safe so externalization is possible later.

## 2. Current Live Workflow

- The current Google Sheets/OpenClaw/Apollo workflow is working and should remain live while the app is built in parallel.
- Early traction: within the first few days, a rep booked a meeting and connect rates were over 12%.
- The goal is not to replace everything immediately, but to gradually move the proven workflow into Newl Apps.

## 3. Core Lead-Gen Workflow

- Admin configures multiple TradeMining search profiles in Newl Apps.
- Profiles can include multiple destination markets/ports such as Houston and Charlotte.
- Profiles can include flexible origin/ship-from ports, origin countries, product keywords, HS codes, lookback windows, shipment volume thresholds, and schedule metadata.
- OpenClaw acts as a replaceable data collector/worker.
- n8n may schedule or orchestrate jobs.
- Newl Apps is the source of truth for configuration, scoring, candidate review, pipeline, approvals, and audit history.

## 4. Data Flow

- OpenClaw/n8n fetches active search profiles from Newl Apps.
- OpenClaw runs TradeMining searches.
- OpenClaw posts raw TradeMining results back into Newl Apps.
- Newl Apps stores raw records, normalizes company names, deduplicates companies, updates shipment summaries, and recalculates scores.

## 5. Candidate Feed Before Pipeline

- Companies should not automatically enter the sales rep pipeline.
- Incoming companies should first appear in a ranked Candidate Feed / Prospect Review page.
- Companies are ranked before being pulled into the sales pipeline.
- Reps should focus only on approved, higher-ranking companies.
- Candidate ranking should update regularly as daily TradeMining data changes.

## 6. Lead Scoring

Lead score should consider:

- shipment frequency
- shipment volume
- shipment recency
- destination market/port match
- origin/ship-from match
- lane/location fit
- product or HS code fit
- ICP fit
- whether the company is already in pipeline
- whether the company was disqualified
- whether useful Apollo contacts exist later

## 7. Approval Workflow

- High-ranking companies can be approved into the sales rep pipeline.
- Low-quality companies can be rejected or disqualified.
- Approved companies can later be approved for Apollo enrichment.

## 8. Apollo Workflow Later

- Do not build Apollo live writes yet.
- After company approval, Apollo enrichment should find contacts.
- Contacts should be ranked by role/title/seniority.
- Contacts should be classified into tiers.
- Contact tier determines recommended Apollo sequence.
- Human approval should happen before sequence enrollment.

## 9. AI Usage

- Do not use AI for simple deterministic logic like counting shipments or filtering ports.
- AI can help with ambiguous company normalization, product/category classification, ICP fit explanations, contact role classification, and sequence tier recommendations.
- AI logic should live server-side in Newl Apps where possible, not hidden in n8n.
- AI output should be auditable and reviewable.
- For the Company Assistant, the long-term model strategy is to run the AI bot on a local model hosted on Newl-controlled server/network infrastructure.
- Until the local model is proven and reliable, use a cost-effective OpenAI model behind a provider abstraction so model providers can be swapped without rewriting assistant workflows.
- Assistant prompts, retrieved sources, memory updates, and tool calls must stay tenant-scoped and auditable regardless of whether the active model provider is OpenAI or a local server-hosted model.

## 10. What Not To Build Yet

- Do not build billing.
- Do not build external customer portals.
- Do not make manual CSV upload the primary workflow.
- Do not fully automate Apollo sequence pushes.
- Do not replace OpenClaw immediately.
- Do not move all business logic into n8n.

## Near-Term PR Milestones

### PR 1 - Product context and workflow instructions

- Add PRODUCT_OPERATING_BRIEF.md
- Update AGENTS.md so Codex reads this brief before implementation
- Document internal-first direction and current Sheets workflow remaining live

### PR 2 - Newl branding and theme

- Add Newl-inspired theme tokens
- Style sidebar, dashboard, cards, tables, buttons, and active nav states
- Keep tenant-level branding extensible for later

### PR 3 - TradeMining search profile admin

- Add models/UI for configurable search profiles
- Support multiple destination markets/ports, including Houston and Charlotte
- Support origin ports, ship-from ports, origin countries, product keywords, HS codes, lookback windows, volume thresholds, and schedule metadata

### PR 4 - OpenClaw/n8n ingestion API

- Add endpoint for OpenClaw/n8n to fetch active search profiles
- Add endpoint for OpenClaw/n8n to post TradeMining batch results
- Add tenant-scoped ingestion authentication
- Add ingestion/job logs

### PR 5 - Ranked Candidate Feed

- Normalize company names
- Deduplicate companies within tenant
- Update shipment summaries
- Score companies by volume, frequency, recency, lane fit, destination match, origin match, and product fit
- Show ranked companies before pipeline

### PR 6 - Approve into sales pipeline

- Add approve/reject actions from Candidate Feed
- Approved companies move into sales rep pipeline
- Rejected/disqualified companies stay out of pipeline
- Track audit history

### PR 7 - Performance reporting

- Track companies pulled, companies approved, connect rates, replies, meetings, and results by profile/port/lane/rep
- Keep current Sheets workflow live while validating app workflow

### PR 8 - Apollo enrichment dry run

- Add Apollo mock/dry-run enrichment after company approval
- Rank contacts by title/seniority/department
- Classify contacts into tiers
- Do not push live sequences yet

### PR 9 - Sequence recommendation and approval

- Recommend Apollo sequence based on contact tier
- Require human approval before sequence enrollment
- Add audit logs and safety checks
