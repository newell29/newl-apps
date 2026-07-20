# Website Growth Content Opportunity Module

## Purpose

The Website Growth module turns search, analytics, and Newl Apps operating data into a decision queue for inbound growth work. It is not a replacement for Semrush. Semrush remains useful for rank tracking, competitor research, and external SEO audits. This module decides what Newl should do next: improve a page, create a page, add a section, add internal links, publish a resource article, monitor, or ignore.

## Data Sources

The queue uses three source categories:

- Google Search Console API: queries, pages, clicks, impressions, CTR, and average position.
- Manual uploads: Semrush exports, GA4 exports, Search Console exports, or one-off CSV/TSV research.
- Newl Apps internal data: website inbound submissions, lead-producing pages, primary needs, companies, contacts, pipeline records, and finance credit checks.

Future modules should feed this queue instead of living separately when they create website growth signals. Examples:

- Blog engine: drafts, published posts, topic clusters, internal links, and article performance.
- Glossary engine: glossary terms, commercial page links, and definition-page performance.
- Website inbound: submitted forms, source page, selected need, company, email, and lead quality.
- Lead generation: target industries, service demand, company segments, and outbound learnings.
- Finance credit checks and account setup: real customer categories and services requested.

## Google Search Console API

Search Console sync supports either OAuth refresh-token credentials or service-account credentials.

OAuth environment variables:

- `GOOGLE_SEARCH_CONSOLE_SITE_URL`
- `GOOGLE_SEARCH_CONSOLE_CLIENT_ID`
- `GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET`
- `GOOGLE_SEARCH_CONSOLE_REFRESH_TOKEN`

Service-account environment variables:

- `GOOGLE_SEARCH_CONSOLE_SITE_URL`
- `GOOGLE_SEARCH_CONSOLE_SERVICE_ACCOUNT_EMAIL`
- `GOOGLE_SEARCH_CONSOLE_PRIVATE_KEY`

The service account must be added to Google Search Console as a user for the relevant property. For a domain property, use a value like `sc-domain:newlgroup.com`. For a URL-prefix property, use the exact canonical URL property.

## Google Analytics 4

GA4 is represented in the connection status and can be manually imported today. The API fields are reserved so the module can add direct GA4 sync without changing the data model:

- `GA4_PROPERTY_ID`
- `GA4_CLIENT_EMAIL`
- `GA4_PRIVATE_KEY`
- `GA4_CLIENT_ID`
- `GA4_CLIENT_SECRET`
- `GA4_REFRESH_TOKEN`

GA4 should be used for engagement, landing page behavior, and form-conversion context. Search Console should remain the primary source for query and ranking opportunities.

## Opportunity Lifecycle

Statuses:

- New
- Reviewing
- Approved
- In progress
- Published
- Rejected
- Monitoring

Actions:

- Create page
- Improve existing page
- Add section
- Add internal links
- Create resource article
- Update redirect
- Monitor
- Ignore

## Scoring Logic

The first scoring pass considers:

- Commercial relevance to Newl services.
- Search demand from impressions.
- Click traction.
- Ranking position, especially positions 9-30.
- Existing page match.
- Existing lead evidence from Newl Apps.

The score is intentionally directional. It ranks work for review; it does not auto-publish content.

## Operating Workflow

1. Sync Search Console or import Semrush/Search Console/GA4 exports.
2. Generate opportunities from internal Newl Apps data.
3. Review high-score items.
4. Approve work that maps to a real service, industry, location, blog, glossary, or redirect need.
5. Execute the content work in the website repo.
6. Mark items as published and monitor future Search Console/GA4 movement.
