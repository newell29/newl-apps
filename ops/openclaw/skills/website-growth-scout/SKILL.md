# Website Growth Scout

## Role

Scout is a dedicated weekly website-research and brief-preparation worker. It is separate from Hunter. Hunter collects lead-discovery evidence; Scout evaluates website growth ideas using Search Console, GA4, sanitized first-party form counts, the current website repository, and the official SEMrush MCP server.

## Scheduled flow

1. Call `POST /api/website-growth/scout/prepare` with the dedicated Scout bearer token.
2. Newl Apps refreshes tenant-scoped Search Console, GA4, and aggregate website-form evidence, then prepares the bounded weekly candidate packet.
3. Run Codex with `gpt-5.6-sol`, high reasoning, an ephemeral session, and a read-only sandbox in the Newl website repository.
4. Codex must query `https://mcp.semrush.com/v1/mcp` through the official OAuth connection and return the repository-owned output schema, including the current Position Tracking campaign and tracked-keyword snapshot even when no page candidates exist.
5. Call `POST /api/website-growth/scout/complete` with only the run ID and structured completion. Newl Apps validates candidate scope, stores sanitized SEMrush evidence, saves drafts, deduplicates approved-page keywords against the live tracking snapshot, and returns the deterministic Teams report plus spreadsheet payloads.
6. Send the report to the configured Microsoft Teams target. Attach the weekly performance workbook on every completed run and attach the SEMrush import workbook when it contains new keywords. The owner or authorized manager reviews each saved brief in Newl Apps; keyword tracking additions do not have a separate approval step.

The repository runner `ops/openclaw/run-website-growth-scout.sh` implements this flow. Install it with `ops/openclaw/install-website-growth-scout.sh` only after `ops/openclaw/configure-semrush-mcp.sh` completes the official SEMrush OAuth approval.

## Boundaries

- Never use a SEMrush username, password, browser login, or copied API key. Use only the official read-only MCP OAuth connection.
- Never send names, email addresses, phone numbers, message bodies, or raw form submissions to Codex or SEMrush.
- Do not approve content, confirm claims, modify the website repository, open a pull request, merge, deploy, publish, or request indexing.
- Do not use Hunter credentials or state. The Scout token, environment file, job record, and Codex session are separate.
- Do not relabel SEMrush search volume as Search Console impressions. Preserve source attribution.
- Do not silently continue without SEMrush. If MCP authentication or access fails, mark the run failed and surface it for review.
- A run with no candidates is normal. It sends the weekly tracking report but no Teams approval request.

## Success

A successful run has a tenant-scoped `AutomationJobRun`, evidence-import records for configured sources, an official-MCP SEMrush import and tracking snapshot, and a Teams report. It may have zero review drafts. Human brief approval—not Scout—starts the developer workflow; approved keywords are automatically prepared for SEMrush tracking.
