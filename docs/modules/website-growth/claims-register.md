# Website claims register — initial research

> Status: researched from the current website repository on 2026-07-22. Repository presence proves that a claim is published; it does not prove the underlying fact. Owner confirmation and source documents are still required where noted.

| Claim family | Current examples | Repository evidence | Recommended status | Evidence needed before reuse |
| --- | --- | --- | --- | --- |
| Operating history | `35+ years`, `since 1989` | `lib/pages/services.ts`, `lib/newl-content.ts` | Low risk, confirm annually | Incorporation/company-history record and agreed wording. `35+` remains mathematically conservative in 2026. |
| Inventory accuracy | `99.24% inventory accuracy` | Repeated in `components/HeroWmsPreview.tsx`, `lib/pages/services.ts`, `lib/pages/industries.ts`, `lib/newl-content.ts` | Do not reuse automatically | Exact calculation, included warehouses/customers, sample size, reporting period, exclusions, data owner, and next review date. |
| Order accuracy | `98.97% order accuracy` | Repeated in `lib/pages/services.ts`, `lib/newl-content.ts`, and industry content | Do not reuse automatically | Definition of an accurate order, denominator, channels included, reporting period, source report, owner, and next review date. |
| Receiving speed | `dock-to-stock in under two days` | `lib/pages/services.ts`, `lib/pages/locations.ts`, `lib/industries/pages.ts` | Do not reuse automatically | Start/end timestamps, business-day treatment, percentile or average, facility scope, exceptions, reporting period, and owner. |
| NVOCC | Newl operates as an NVOCC; contracted/spot ocean options | `lib/pages/freight.ts`, partner asset | Confirm current document | Current licence/registration, legal entity, permitted geography, expiry/review date. Carrier-rate language also needs current commercial confirmation. |
| IATA | IATA member with direct carrier booking capability | `lib/pages/freight.ts`, partner asset | Confirm current document | Current membership record, legal entity, capability wording, expiry/review date. |
| TSA / Partners in Protection | Certification/facility claims | `lib/newl-content.ts`, `lib/pages/locations.ts`, partner assets | Confirm current document | Current certificate, covered facility/entity, expiry/review date. |
| Amazon SPN | Amazon SPN participant | `lib/pages/locations.ts`, `lib/pages/industries.ts`, partner asset | Confirm current program status | Current program listing or agreement, permitted logo/wording, review date. |
| Customer proof | Named accounts, customer logos, testimonials, case studies | `public/customers/*`, `lib/pages/freight.ts`, logo components | Permission required | Written permission, approved logo asset/quote, approved scope and duration. |
| Comparative or guarantee language | `best`, `#1`, `guaranteed`, `always`, `zero errors` | Not approved as a claim class | Block | Replace with bounded capability language; owner approval alone is insufficient. |

## Pending-safe copy

Until evidence is attached, use capability wording rather than an outcome claim. Examples:

- Replace a specific accuracy percentage with “barcode-supported inventory controls, cycle counts, reconciliation, and account reporting.”
- Replace “dock-to-stock in under two days” with “receiving, devanning, verification, and putaway workflows planned around the inbound program.”
- Replace an unverified certification statement with a description of the operational service; add the affiliation only after its current document is confirmed.
- Omit customer names and logos unless the approved permission record is linked to the brief.

The first owner review should decide whether to retain, revise, or temporarily remove the three repeated performance metrics from existing pages. That is a business/content decision and is not changed by this implementation.
