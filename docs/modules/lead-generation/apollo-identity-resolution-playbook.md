# Apollo company identity-resolution playbook

> Evidence status: Confirmed from the implemented Newl Apps/Apollo workflow. The owner approved the automatic threshold and fail-closed policy on August 2, 2026. Production enablement remains a separate environment/configuration change.

## Purpose

This playbook records the repeatable process for resolving an Apollo exception without relying on Apollo's Suggested Leads widget, a saved-account shell, or repeated speculative searches. It is the operating specification for the next identity-resolution automation phase.

The outcome of one review must be one of:

- a reviewer-confirmed Apollo account and canonical global organization;
- a mapped company whose canonical organization currently has no employees;
- a confirmed duplicate, irrelevant company, or no usable Apollo match; or
- an explicit ambiguous state that preserves the candidates and evidence for human review.

Company mapping, employee discovery, email recovery, buyer selection, Outreach Plan generation, and cadence enrollment are separate states. Completing one state must not imply that a later state succeeded.

## Current manual verification procedure

### 1. Freeze the Newl company identity

Record the tenant company ID and the current identity packet before searching:

- TradeMining legal/display name and normalized name;
- known operating brand and aliases;
- official domain when already verified;
- consignee/import address and target geography;
- recent shipment or opportunity evidence;
- existing Apollo account ID, organization ID, domain, and match history; and
- whether the company or any resolved contact is already in a Hunter cadence.

Do not infer the operating brand only from a legal suffix or facility label. A numbered corporation, distribution-center label, or regional legal entity may trade under a different public brand.

### 2. Establish the public operating identity

Use bounded public research to identify an official domain, operating brand, and relevant address. Prefer:

1. the company's official website;
2. government or trademark records that explicitly connect a legal entity to a brand;
3. first-party location/contact pages; and
4. independent trade records that reproduce the same legal name and address.

Directories and similarly named companies are candidate evidence only. Preserve the selected sources and the legal-name-to-brand rationale.

### 3. Search Apollo's company directory

Use Apollo **Find companies** and its Company filter, not Quick Search and not the account page's Suggested Leads subset.

Search in this order:

1. exact official domain;
2. exact operating brand;
3. legal name with suffixes removed;
4. regional or canonical parent/brand name; and
5. a distinctive brand token plus city/state when necessary.

For every candidate, compare:

- Apollo domain versus the verified official domain;
- company and parent/brand names;
- operating city/state/country;
- employee count and industry;
- LinkedIn/company website links; and
- whether the candidate is an empty saved-account shell or a populated global organization.

Never select a candidate only because its name is similar.

### 4. Preserve both Apollo identifiers

An Apollo `#/accounts/<id>` URL identifies a saved CRM account. An Apollo `#/organizations/<id>` URL identifies a global organization. These IDs are not interchangeable.

When an employee supplies an account URL:

1. treat the explicit reviewer confirmation as authoritative for company choice;
2. persist the supplied account ID;
3. resolve and persist the nested canonical organization ID when Apollo exposes it;
4. retain the account-to-organization relationship in the match query/audit payload; and
5. never replace it with a similarly named parent, sibling, or same-domain record without another explicit confirmation.

When the existing mapping is empty or incorrect, the replacement must be recorded as a new reviewer-confirmed mapping; prior match history remains immutable.

### 5. Verify the complete organization roster

Open People Finder with only the canonical organization filter:

```text
https://app.apollo.io/#/people?organizationIds[]=<canonical-organization-id>
```

Wait for the company chip and Total/Net New/Saved counts to settle. Record:

- canonical organization ID;
- company chip shown by Apollo;
- total, net-new, and saved counts;
- verification time; and
- a bounded sample of role/title/geography rows.

This full roster is the verification source. Do not use:

- only the account page's Suggested Leads list;
- only the first 25 saved contacts;
- an account ID in the `organizationIds[]` filter; or
- a People Finder page that still shows the previous company while Apollo is loading.

If the full roster is populated but Newl Apps returns zero, classify the result as an integration/retrieval defect. Do not ask the employee to repeat the same mapping or spend another organization-search credit.

### 6. Run employee discovery before paid enrichment

From Apollo Exceptions, run **Search company employees and build plans** with optional paid enrichment disabled first.

The no-cost path must:

1. search the exact confirmed global organization;
2. merge all relevant saved-contact pages within the safety cap;
3. run generic and relevant-title People Search;
4. resolve masked people against saved contacts by person/contact ID, then LinkedIn/email, then strict company + first name + title;
5. rank no more than the configured maximum contacts; and
6. report employee, evaluated-contact, and QA-passed-plan counts separately.

If no saved contact has a usable email, paid email-only enrichment remains a separate explicit authorization for at most three selected people. Phone, personal-email, and waterfall enrichment remain disabled.

### 7. Confirm plan and suppression outcomes

For each selected contact, verify:

- exact company identity;
- relevant buyer role, seniority, and geography;
- concrete usable business email;
- no reply, bounce, rejection, do-not-contact state, or active Hunter outreach;
- grounded Outreach Plan and deterministic/model QA result; and
- whether a prior finished cadence requires an explicitly approved re-engagement.

A company-level roster result is not proof that a contact or plan was created. A contact without a usable email is retained for audit but is not actionable.

## Audit record required for each resolution

The resolver should persist or expose the following without secrets:

- tenant and company IDs;
- legal name, normalized name, aliases, domain, and address evidence;
- supplied Apollo URL, resource type, and supplied ID;
- every bounded Apollo candidate considered;
- selected saved-account ID and canonical organization ID;
- candidate score components and rejection reasons;
- reviewer identity, confirmation, and timestamp;
- People Finder company chip and roster counts;
- lookup scopes attempted and API page counts;
- masked, saved, and paid-email recovery counts;
- contacts evaluated, contacts selected, and plans created;
- the final exception state; and
- exact retry/failure category.

### Machine-readable resolution packet

The next resolver should produce one structured packet before it is allowed to recommend a mapping. This packet is
also the handoff contract between public identity research, Apollo company matching, roster retrieval, and contact
planning:

```json
{
  "companyId": "tenant-scoped-company-id",
  "inputIdentity": {
    "legalName": "Example Legal Entity Inc.",
    "operatingBrand": "Example Brand",
    "aliases": ["Example Regional Facility"],
    "officialDomain": "example.com",
    "address": {
      "city": "Charlotte",
      "region": "North Carolina",
      "country": "United States"
    }
  },
  "publicEvidence": [
    {
      "url": "https://example.com/locations/charlotte",
      "sourceType": "official_company",
      "supports": ["operating_brand", "domain", "address"]
    }
  ],
  "apolloCandidates": [
    {
      "savedAccountId": "optional-saved-account-id",
      "globalOrganizationId": "canonical-global-organization-id",
      "name": "Example Brand",
      "domain": "example.com",
      "location": "Charlotte, North Carolina",
      "scoreComponents": {
        "exactDomain": true,
        "compatibleName": true,
        "compatibleLocation": true,
        "explicitAccountOrganizationRelationship": true
      },
      "rejectionReasons": []
    }
  ],
  "decision": {
    "state": "REVIEWER_CONFIRMED",
    "selectedGlobalOrganizationId": "canonical-global-organization-id",
    "selectedSavedAccountId": "optional-saved-account-id",
    "reviewerId": "authenticated-user-id",
    "reviewedAt": "ISO-8601 timestamp"
  },
  "rosterVerification": {
    "companyChip": "Example Brand",
    "total": 125,
    "netNew": 120,
    "saved": 5,
    "verifiedAt": "ISO-8601 timestamp"
  },
  "contactDiscovery": {
    "apiScopesAttempted": ["confirmed_global_organization"],
    "pagesRead": 3,
    "employeesFound": 125,
    "contactsEvaluated": 10,
    "contactsSelected": 3,
    "plansCreated": 3,
    "paidEmailCreditsAuthorized": 0,
    "paidEmailCreditsUsed": 0
  },
  "finalState": "PLANS_READY",
  "failureCategory": null
}
```

The packet must never contain an Apollo API key, session cookie, email-service credential, or other secret. URLs and
IDs must remain tenant scoped in storage and in every subsequent lookup.

### Decision matrix

| Observed state | Required action |
| --- | --- |
| Exact global organization has a populated roster and Newl returns employees | Continue to buyer selection and plan generation. |
| Exact global organization has a populated roster and Newl returns zero | Record `INTEGRATION_RETRIEVAL_DEFECT`; do not remap or spend credits. |
| Reviewer supplied an account URL and its nested global organization is populated | Preserve both IDs and search only that nested global organization. |
| Existing mapping points to an empty shell while a verified canonical parent/brand has the roster | Require one reviewer-confirmed replacement, preserve history, then search the replacement. |
| Canonical organization has a true zero-person roster | Keep a durable mapped/no-employees state and stop automatic retries until evidence changes. |
| Multiple plausible companies remain after domain/address comparison | Keep the record in human review with all candidates and rejection evidence. |
| Selected people have no concrete business email | Keep them out of the actionable queue; request separately authorized email-only enrichment if desired. |
| Contact is active, replied, bounced, rejected, or do-not-contact | Preserve the terminal/active state and do not create or enroll another plan. |

## Implemented exception-autopilot phase

The Mac-mini Hunter service polls a tenant-authenticated prepare route independently of TradeMining and company
research. It claims at most one exception per poll and no more than the configured rolling 24-hour cap. The server
freezes the current unresolved Apollo match, qualified Hunter research signal, current prospecting decision, company
identity, geography, prior candidate ledger, and a SHA-256 identity fingerprint. A fingerprint already attempted is
not searched again until the source match or research evidence materially changes.

The worker runs at most five targeted Brave searches and sends no more than 20 unique HTTPS title/snippet records
back to Newl Apps. GPT-5.6 Luna uses strict Structured Outputs, low reasoning, `store: false`, and no browsing/tools to
synthesize the operating name, legal name, aliases, parent/brand relationship, official domain, and cited evidence.
Luna proposes identity only; deterministic Apollo scoring makes the mapping decision.

Resolver version 3 adds a bounded recovery query for noisy legal-owner or facility labels. When a name contains a
distinctive multi-token tail (for example, a legal owner name whose operating brand omits its first qualifier), the
tail is searched as an operating-brand candidate. After Luna returns cited identity evidence, Apollo searches the
verified official domain and operating-name aliases before repeating the original TradeMining label. Alias hints at
60-84% confidence may widen candidate retrieval, but they cannot satisfy the 90% automatic-mapping gate.
Legacy direct mappings are eligible for one version-3 repair only when they have the exact empty-shell signature:
no company or match domain, a score of 19 or lower, and the durable mapped-zero-employees reason. A populated,
domain-backed, reviewer-confirmed, or higher-scoring direct mapping is not reopened automatically.

Before spending another Apollo organization-search request, the resolver also checks tenant-scoped canonical company
records for one existing Apollo organization on the independently verified official domain. Exactly one organization
may be reused; two different organizations on the same domain remain ambiguous. If the canonical company already has
an Outreach Plan or non-`NOT_STARTED` cadence history, the duplicate alias is mapped for identity/deduplication but a
second contact-discovery handoff is suppressed. This preserves the TradeMining evidence on both legal names without
creating duplicate contacts or another Hunter campaign.

Automatic mapping requires all of the following:

- the synthesis is `EXACT_OPERATING_COMPANY` or `VERIFIED_PARENT_OR_BRAND`;
- public-identity confidence is at least 90;
- at least one supplied public evidence record is cited;
- an official domain is independently verified;
- Apollo returns one unique `DIRECT_COMPANY`; and
- that Apollo organization exactly matches the verified official domain.

Any missing, tied, sibling, different-domain, name-only, or otherwise ambiguous result stays in Apollo Exceptions.
The UI shows the reason, up to three Apollo candidates, and bounded public source links. An automatic mapping queues
the existing assisted contact-discovery handoff; it never approves a contact or plan, enrolls a cadence, spends a
person-enrichment credit, or sends customer communication.

### Deterministic candidate generation

The automated resolver should build a bounded candidate set from:

- the exact existing Apollo mapping;
- exact official domain;
- verified operating brand and legal-name aliases;
- known canonical parent/brand;
- city/state/country; and
- Apollo's documented organization and saved-account endpoints.

Public identity research may suggest aliases and domains, but it cannot authorize the mapping.

### Candidate scoring

Implemented resolver score components:

- exact verified domain: strongest positive signal;
- explicit account-to-global-organization relationship: strongest positive signal;
- exact distinctive brand token and compatible legal name;
- matching operating address/geography;
- compatible industry and company size;
- explicit first-party parent/subsidiary relationship; and
- penalties for different domains, sibling entities, incompatible geography, or generic legal tokens.

Apollo's existing deterministic weights remain the source of truth. The additional 90% public-identity threshold and
exact-domain requirement are a second gate; neither model confidence nor name similarity can bypass Apollo ambiguity.

### Fail-closed decisions

The resolver must not auto-map when:

- two candidates share the same brand/domain evidence without a unique account relationship;
- a legal entity could represent multiple public brands;
- the only evidence is name similarity;
- Apollo returns a sibling or unrelated parent;
- the candidate conflicts with a reviewer-confirmed mapping; or
- the full roster company chip does not match the selected canonical organization.

### Idempotency and deduplication

After confirmation:

- canonical organization ID becomes the tenant-wide company identity key for Apollo;
- account ID remains an immutable supporting identifier;
- aliases reuse the same mapped company instead of creating duplicate contacts or plans;
- contacts dedupe by Apollo person/contact ID, then LinkedIn/email;
- active/terminal cadence and delivery states survive every recheck; and
- the same mapping and roster fingerprint cannot create another outreach plan without a genuinely new approved opportunity.

### Operator experience

The intended UI is a bounded **Suggested mapping** queue:

1. show the public identity packet and up to three Apollo candidates;
2. show exact domain/address/parent differences;
3. preview full-roster counts without revealing paid contact data;
4. allow one explicit confirmation;
5. automatically run the no-cost employee lookup;
6. request paid email-only authorization only when necessary; and
7. show the final contacts/plans or a durable no-employee/no-match reason.

This replaces daily Google/Apollo manual matching for high-confidence cases while retaining a small human queue for ambiguous identities.

## Acceptance criteria for automation

Regression and preview validation must prove:

1. a saved-account shell resolves only to its own nested global organization;
2. a reviewer-confirmed replacement overrides name-similarity warnings and preserves audit history;
3. full-roster verification does not depend on Suggested Leads;
4. a stale/wrong organization ID is detected when the verified canonical candidate has a populated roster;
5. duplicate aliases cannot create duplicate contacts or plans;
6. zero-roster companies stop retrying until identity evidence changes or a reviewer reopens them;
7. no organization-search or person-enrichment credit is consumed without explicit authorization;
8. no customer communication or cadence enrollment occurs from identity resolution; and
9. every query and write remains tenant scoped.
