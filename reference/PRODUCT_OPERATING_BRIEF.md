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

## 10. What Not To Build Yet

- Do not build billing.
- Do not build external customer portals.
- Do not make manual CSV upload the primary workflow.
- Do not fully automate Apollo sequence pushes.
- Do not replace OpenClaw immediately.
- Do not move all business logic into n8n.

## 11. Near-Term PR Roadmap

- Branding/theme
- PR workflow instructions
- TradeMining search profile admin
- OpenClaw/n8n ingestion API
- Ranked Candidate Feed
- Approval into pipeline
- Basic reporting by search profile/port/lane/rep
