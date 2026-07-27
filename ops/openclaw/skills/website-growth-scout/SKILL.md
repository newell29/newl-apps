# Website Growth Scout

## Role

Scout is a dedicated website-research and brief-preparation worker. It is separate from Hunter. Hunter collects lead-discovery evidence; Scout evaluates website growth ideas using Search Console, GA4, sanitized first-party form counts, the current website repository, and the official SEMrush MCP server. The Monday deep run includes a reserved customer-question and AI-answer lane; Tuesday through Friday use deterministic first-party check-ins without Codex or live SEMrush calls.

## Scheduled flow

1. Call `POST /api/website-growth/scout/prepare` with the dedicated Scout bearer token.
2. Newl Apps refreshes tenant-scoped Search Console, GA4, and aggregate website-form evidence, classifies question intent, then prepares the bounded weekly candidate packet.
3. Run Codex with `gpt-5.6-sol`, high reasoning, an ephemeral session, and a read-only sandbox in the Newl website repository.
4. The runner performs bounded Brave Search discovery, records every canonical URL in the tenant-scoped automation ledger, skips URLs seen in prior runs, uses local Qwen for bulk triage, and gives Codex no more than 15 finalists.
5. Codex performs the final backlink review and may promote no more than five public-web prospects to Newl Apps. Raw and rejected search results never appear in the normal Backlinks workspace.
6. SEMrush is optional supporting evidence. Use the official OAuth MCP or the prepared fresh cache when available; return `UNAVAILABLE` without failing the run when API units and a fresh cache are unavailable.
5. Call `POST /api/website-growth/scout/complete` with only the run ID and structured completion. Newl Apps validates candidate scope, stores sanitized SEMrush evidence, saves drafts, retains only backlink prospects that pass deterministic quality gates, deduplicates approved-page keywords against the live tracking snapshot, and returns the deterministic Teams report plus spreadsheet payloads.
6. Send the report to the configured Microsoft Teams target with seven-day signed Newl Apps workbook links. The owner or authorized manager reviews each saved brief in Newl Apps; keyword tracking additions do not have a separate approval step.

The repository runner `ops/openclaw/run-website-growth-scout.sh` implements this flow. Install it with `ops/openclaw/install-website-growth-scout.sh` after the protected Scout environment contains the existing Hunter Brave Search key. SEMrush OAuth may remain configured for optional supporting research.

## Customer-question and AI-answer lane

- Treat packet candidates marked `questionOpportunity` as a distinct review lane.
- Inspect the current website answer before recommending content.
- Prefer a direct, answer-first section on the strongest relevant existing page.
- Use visible FAQs only when they help visitors; never add unsupported or hidden structured data.
- Recommend a dedicated guide only for a substantial, distinct intent that cannot be covered well on an existing page.
- Reject thin question pages, duplicate intent, keyword-swapped pages, and guarantees of AI citations, AI Overviews, rankings, leads, or referrals.

## Boundaries

- Never use a SEMrush username, password, browser login, or copied API key. Use only the official read-only MCP OAuth connection.
- Never send names, email addresses, phone numbers, message bodies, or raw form submissions to Codex or SEMrush.
- Do not approve content, confirm claims, modify the website repository, open a pull request, merge, deploy, publish, or request indexing.
- Do not use Hunter credentials or state. The Scout token, environment file, job record, and Codex session are separate.
- Do not relabel SEMrush search volume as Search Console impressions. Preserve source attribution.
- Do not return or store the raw SEMrush backlink inventory. Return at most 15 prospects after checking the existing Newl Apps backlink memory, rejecting duplicates, link farms, irrelevant directories, automated-link schemes, paid dofollow offers, and high-spam-risk domains.
- Treat paid placements as research-only. They require a separate human spending decision and must not be positioned as a way to purchase ranking credit.
- Continue without live SEMrush only when the prepared packet contains the exact fresh cache permitted by Newl Apps. Preserve its source and observation time.
- A run with no candidates or no qualifying question candidate is normal and still produces the configured Teams outcome.

## Success

A successful run has a tenant-scoped `AutomationJobRun`, evidence-import records for configured sources, a live or explicitly dated cached SEMrush import and tracking snapshot, a curated backlink review, and a Teams report. It may have zero review drafts and zero backlink prospects. Human brief approval—not Scout—starts the developer workflow; approved keywords are automatically prepared for SEMrush tracking.
