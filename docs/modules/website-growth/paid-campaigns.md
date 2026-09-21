# Paid campaigns and Newl Scout — Phase 1

> Evidence status: Confirmed from code for Phase 1. Funnel milestone interpretation and production alert thresholds require owner review. Google Ads synchronization and offline conversion upload are not implemented.

## Delivered in Phase 1

- `/website-growth/paid-campaigns` is a separate Website Growth area, not an SEO signal list.
- It reports genuine paid-search form submissions, qualified-or-later leads, quote-or-later leads, Won, Lost, and lead-to-stage rates.
- Results group by campaign, keyword, landing page, source, and location. Date, campaign, channel, location, and current-status filters are tenant scoped.
- The underlying lead table links to Inbound Opportunities and labels attribution as Complete, Partial, or Unavailable.
- Cost cards do not render until verified Google Ads synchronization records exist. No spend, CPL, qualified CPL, cost per quote, or acquisition cost is fabricated.
- Hourly deterministic Scout health checks and a weekly paid review use the existing tenant-scoped job ledger. Scout records evidence and recommendations only; it has no Google Ads mutation capability.

The current cumulative funnel interpretation is **inferred and requires owner confirmation**: `QUOTE_SENT` and `WON` count as having reached Qualified, and `WON` counts as having reached Quote sent. Lost remains its current explicit status because the point at which a lost lead exited the funnel is not known. Existing legacy `REVIEWED`, `CONVERTED`, and `CLOSED` values are not reinterpreted.

## Signals and thresholds

Paid signals use these types:

- `PAID_TRACKING_ISSUE`
- `PAID_SYNC_FAILURE`
- `BUDGET_PACING`
- `WASTED_SPEND`
- `NEGATIVE_KEYWORD`
- `LANDING_PAGE_OPPORTUNITY`
- `SCALE_CANDIDATE`

Health checks cover paid submissions stopping after a meaningful baseline, missing campaign attribution, click-ID capture stopping, inconsistent test exclusion, the latest configured sync failing, spend without leads, and budget pacing when cost/budget data exists. Weekly review covers campaign, keyword, landing-page, geography and device lead quality; search-term and negative-keyword evidence activates only when synchronized search-term/cost rows exist.

Defaults are deliberately conservative and configurable through `PAID_SCOUT_STOP_WINDOW_HOURS`, `PAID_SCOUT_BASELINE_DAYS`, `PAID_SCOUT_MIN_BASELINE_LEADS`, `PAID_SCOUT_MIN_CLICK_ID_SAMPLE`, `PAID_SCOUT_MISSING_CAMPAIGN_ALERT_COUNT`, `PAID_SCOUT_MIN_LANDING_LEADS`, `PAID_SCOUT_LOW_QUALIFIED_RATE`, `PAID_SCOUT_SCALE_QUALIFIED_RATE`, `PAID_SCOUT_WASTED_SPEND_AMOUNT`, `PAID_SCOUT_DAILY_BUDGET`, and `PAID_SCOUT_PACING_RATIO`. `PAID_SCOUT_DAILY_BUDGET` is unset by default, so pacing alerts remain disabled until an owner supplies a budget.

The Vercel schedules call the health check at minute 17 hourly and the weekly review Monday at 13:30 UTC. Both routes use the existing cron authentication and ingestion tenant binding. They write only application evidence/signals; they never change ads.

## Phase 2 prepared, not implemented

`WebsitePaidCampaignMetric` is an empty, tenant-scoped future synchronization ledger for daily Google Ads campaign, ad-group, keyword, search-term, device and geography metrics, including impressions, clicks, cost and currency. `WEBSITE_GROWTH_GOOGLE_ADS_SYNC` is the reserved job type for retry/failure monitoring. Phase 2 still needs reviewed OAuth/credential storage, a Google Ads client, daily idempotent sync, retry policy, source-key construction, reconciliation, and Preview validation.

Cost calculations activate only when cost rows exist in exactly one currency for the selected period. Joining lead outcomes to advertising data must prefer captured campaign/click identifiers and disclose unmatched rows. Search-term quality and negative-keyword recommendations require synchronized search-term data.

## Phase 3 prepared, not implemented

`WebsiteAdsOfflineConversion` is a tenant- and submission-scoped ledger with unique Qualified, Quote sent, and Won milestones. It can hold the chosen GCLID/GBRAID/WBRAID, conversion time/value, attempt count, provider result, completion time, and failure reason. The uniqueness constraint prevents duplicate milestone records.

Phase 3 still needs an explicit conversion-name mapping, owner-approved values/currency rules, deterministic creation from audited status transitions, Google Ads upload code, retry rules that distinguish confirmed from uncertain results, and operational review. No conversion row is currently created or uploaded.

## Human boundary

Scout's weekly recommendation is one of Increase, Maintain, Reduce, or Investigate with evidence and limitations. Without cost data it cannot support Increase or Reduce. Every budget, bid, keyword, negative-keyword, audience, campaign, and synchronization enablement decision remains a separate human-approved action.
