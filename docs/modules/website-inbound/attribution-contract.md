# Website inbound attribution contract

> Evidence status: Confirmed from code for the accepted payload and normalization rules. The website's deployment of the six new Google Ads fields must be verified in the website repository and a Vercel Preview.

`POST /api/website-inbound` remains bearer-token authenticated and tenant scoped. The existing required envelope is unchanged:

```json
{
  "formType": "assessment",
  "source": "website",
  "pageUrl": "https://www.newlgroup.com/contact",
  "fields": {
    "Company": "Synthetic Company",
    "City": "Toronto",
    "Province": "Ontario"
  }
}
```

`formType` and `fields` remain required. `fields` values must be strings or arrays of strings. The full accepted JSON request is saved as `rawPayload` for website-form records; the sanitized `fields` evidence is still stored separately and the current editable contact summary remains unchanged. Historical rows retain a clearly marked compatibility envelope because the pre-migration top-level request cannot be reconstructed.

## Exact accepted attribution field names

The following optional fields are accepted at the top level. Use these exact camel-case names:

| Field | Format | Notes |
| --- | --- | --- |
| `utmSource` | string | For example `google`. |
| `utmMedium` | string | `cpc`, `ppc`, `paid`, `paid_search`, `paid-search`, or `sem` classifies as paid search. |
| `utmCampaign` | string | Human-readable campaign name when available. |
| `utmTerm` | string | Captured keyword/term; absence is retained as unavailable. |
| `utmContent` | string | Ad/content variation. |
| `gclid` | string | Google click ID. |
| `gbraid` | string | Google app/iOS click identifier. |
| `wbraid` | string | Google web-to-app/iOS click identifier. |
| `gaClientId` | string | GA client ID. |
| `campaignId` | string | Google Ads campaign ID. Website change still required. |
| `adGroupId` | string | Google Ads ad-group ID. Website change still required. |
| `creativeId` | string | Google Ads creative ID. Website change still required. |
| `matchType` | string | Google Ads match type. Website change still required. |
| `network` | string | Google Ads network. Website change still required. |
| `device` | string | Google Ads device. Website change still required. |
| `landingPage` | string | Original landing URL, including ordinary attribution parameters. |
| `landingPath` | string | Original landing path. Derived from `landingPage` when omitted. |
| `firstReferrer` | string | First referrer URL. |
| `firstReferrerDomain` | string | Referrer hostname. Derived from `firstReferrer` when omitted. |
| `sessionStartedAt` | ISO-8601 string | Prefer a UTC timestamp with `Z`. Invalid values remain unavailable. |
| `submittedAt` | ISO-8601 string | Prefer a UTC timestamp with `Z`; server receipt time is the fallback. |
| `trafficSourceGuess` | string | Website-side deterministic guess. It is evidence, not a trusted lifecycle value. |
| `attributionConfidence` | string or number | Preserved as a bounded string for display. |
| `isTest` | boolean | Set `true` for diagnostics, synthetic monitoring, QA and automated form checks. |

Existing forms that still place values in `fields` remain compatible. The normalizer recognizes the camel-case keys, snake-case variants, and existing labels such as `Attribution - UTM Source`, `Attribution - GCLID`, and `Attribution - Landing Page`. New website work should use the top-level contract.

The website must add only these six fields for the requested next step: `campaignId`, `adGroupId`, `creativeId`, `matchType`, `network`, and `device`. They should be captured from the first landing URL/session context, carried across navigation, and submitted unchanged with every form. Do not invent IDs when the value is unavailable.

## Classification and exclusions

- Paid media values, GCLID/GBRAID/WBRAID, or Google Ads campaign/ad-group/creative IDs classify the submission as `PAID_SEARCH`.
- Organic search, AI referral, direct, local, referral, other, and unknown remain distinct channel values.
- `isTest: true`, the `codex_weekly_diagnostic` query parameter, and exact form-type/source markers `codex_diagnostic`, `automated_check`, `form_health_check`, `synthetic_check`, `qa_test`, `internal`, `internal_test`, `employee`, or `employee_test` set a durable exclusion reason and the Test workflow status.
- Test/internal records are retained in Inbound Opportunities and excluded from Website Growth, Paid Campaigns, funnel calculations, and Scout evidence.
- Location reporting is derived from ordinary form fields such as location, city, province/state, and country. No location is inferred when those fields are missing.

The public route still ignores client-supplied tenant, owner, entry method, and lifecycle status. `account_setup` continues to route to Finance. Google Ads OAuth, spend synchronization, and offline conversion upload are not part of this contract.
