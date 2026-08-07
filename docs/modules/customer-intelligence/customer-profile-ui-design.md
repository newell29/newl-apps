# Customer Profile: UI Design Reference

> Evidence status: Owner-reviewed UX baseline. The screens and interaction rules below are approved as the implementation target; provider selection, persistence changes, and integration execution remain separately planned and reviewed.

## Required reference

The interactive high-fidelity reference is:

- `docs/modules/customer-intelligence/customer-profile-wireframes.html`

All companies, contacts, addresses, financial values, news items, and import
records in the reference are synthetic. They must never be replaced with live
customer data in source control, tests, screenshots, documentation, or pull
request text.

Builders implementing CP-PHASE-02B-3 and later Customer Profile phases must
inspect both this document and the wireframe before changing UI or interaction
behaviour. Reviewers should use them as the visual and behavioural acceptance
reference, while still requiring the repository's tenant, permission, evidence,
and human-approval controls.

## Approved information architecture

The Customer Intelligence experience consists of:

1. **Matched company directory** — canonical companies, lifecycle, operating-
   company relationships, QuickBooks source-account count, opportunity-signal
   count, financial summaries, and last activity.
2. **Identity review queue** — unmatched QuickBooks customers with deterministic
   match evidence, suggested canonical company, potential contacts derived from
   authorized email evidence, and explicit approve/reject/defer controls.
3. **Canonical company profile** — overview, contacts, opportunities,
   opportunity signals, financials, and an evidence/audit timeline.

Roadmap approval does not authorize implementing all of these areas in one
phase. The controller must continue to send only the explicitly approved phase
to the builder.

## Identity review rules

- A QuickBooks customer name alone never approves a match or creates a
  canonical `Company`.
- The UI must show source evidence and why a candidate was suggested.
- Potential contacts may be shown from authorized email metadata/signature
  evidence, but remain suggestions until the company identity is approved.
- Full email bodies, attachments, unrelated subjects, and private reasoning are
  not displayed or persisted by this UI.
- Approve, reject, and defer actions must use the existing tenant-scoped
  authorization, validation, audit, and reviewed-decision preservation rules.
- No external communication or source-system write is permitted from identity
  review.

## Contact management

Authorized users should be able to add and edit contacts, including name, job
title, email address, phone, operating-company relationship, and contact status.

Implementation requirements:

- Preserve normalized `ContactPoint` identity and deterministic deduplication.
- Treat email replacement as a reviewed correction: retain prior evidence and
  record the new value instead of silently rewriting accepted evidence.
- Never merge contacts by name alone.
- Show the source and verification state for contact facts.
- Respect the current Customer Intelligence permissions. A visible edit control
  must not substitute for server-side mutation authorization.
- Every material manual correction must be tenant-scoped and auditable.

## TradeMining identity and import monitoring

The canonical Newl Apps `Company.name` is not assumed to equal the importer or
consignee name used by TradeMining. Each company needs a separately managed
TradeMining identity profile containing:

- primary TradeMining search name;
- alternate legal names, former names, and observed consignee aliases;
- country and primary region;
- known importer addresses or other deterministic disambiguators;
- monitoring frequency; and
- match status and human-confirmation evidence.

Editing a TradeMining search identity must not rename, merge, or automatically
approve the canonical `Company`. A changed search identity should rerun the
read-only match and return evidence for human confirmation. Ambiguous matches
remain blocked; a model or integration must not silently select one.

The wireframe shows weekly import monitoring, latest import, top origin
countries, commodity summary, shipment history, and period-over-period shipment
counts. These are target presentation concepts, not evidence that a persistence
model, schedule, or TradeMining integration for Customer Intelligence already
exists.

## News and opportunity signals

Recent public news and TradeMining observations may produce reviewable sales
signals. Each signal should retain:

- source type and source reference;
- observed or published date;
- the factual observation;
- the possible service need as an explicitly labeled inference;
- suggested contact when supported by existing contact evidence; and
- reviewer disposition or resulting opportunity reference.

Signals never create or advance an opportunity automatically. Creating a draft
opportunity requires an authorized human action. Signals never authorize
outreach, Apollo enrollment, Teamship activity, QuickBooks writes, production
writes, or customer communication.

## Phase and implementation boundaries

The reference spans multiple roadmap phases for continuity:

- **CP-PHASE-02B-3**: deterministic identity reconciliation and human review.
- **CP-PHASE-02B-4**: Customer Profile directory and profile UI on approved
  foundation data.
- **CP-PHASE-02B-5**: financial materialization and reporting presentation.
- **Later separately approved work**: Microsoft 365 contact extraction,
  TradeMining identity persistence/monitoring, public-news collection, and
  opportunity-signal conversion.

The wireframe does not authorize a migration. If TradeMining identities, news
signals, or opportunity evidence require new persistence, the builder must stop
and return the proposed schema, tenant constraints, rollback considerations,
and migration plan for explicit owner approval.

## Reviewer acceptance checklist

A reviewer should reject an implementation that:

- omits tenant filtering or relies only on client-side permissions;
- approves or creates a company from a name-only match;
- exposes secrets, raw email bodies, or live customer data;
- silently overwrites reviewed contact evidence;
- couples the canonical company name to an external TradeMining spelling;
- treats an inferred news/import signal as a confirmed customer requirement;
- automatically creates opportunities or performs outreach/external writes;
- implements a later-phase area without explicit phase approval; or
- claims the complete wireframe is implemented when only one approved phase is
  present.

Visual differences are acceptable when required by existing Newl Apps component
patterns, accessibility, responsiveness, or implemented data constraints. The
information architecture, evidence visibility, editable TradeMining identity,
contact correction behaviour, and human-approval boundaries are the required
behavioural baseline.
