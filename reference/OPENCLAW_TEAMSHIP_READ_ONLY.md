# OpenClaw Teamship Read-Only Activation

Status: Draft rollout guide. This activates only scoped reads. It does not authorize Teamship writes, printing, receiving, picking, packing, or administrative access.

## Architecture

OpenClaw keeps the four curated Teamship documents in local agent context for procedural questions. Current-record questions call Newl Apps through `POST /api/assistant/teamship/read`. Newl Apps resolves the employee membership, applies the named internal-user policy, checks the tenant module and exact customer/warehouse scope, resolves encrypted Teamship credentials, runs the API or guarded browser reader, minimizes the response, and writes the access audit.

OpenClaw must not hold the Teamship password. The password remains in the tenant Teamship integration credential in Newl Apps.

## Deployment Configuration

Configure these secrets and runtime values on the Newl Apps process that can launch Chrome:

```bash
OPENCLAW_TEAMSHIP_READ_TOKEN='<dedicated random token>'
OPENCLAW_TEAMSHIP_TENANT_SLUG='newl-group'
TEAMSHIP_BROWSER_READ_RUNTIME_ENABLED='true'
TEAMSHIP_BROWSER_EXECUTABLE_PATH='/usr/bin/google-chrome'
TEAMSHIP_BROWSER_READ_HEADED='false'
TEAMSHIP_BROWSER_READ_TIMEOUT_MS='30000'
TEAMSHIP_BROWSER_ALLOWED_HOSTS='app.teamshipos.com,members.fulfillit.io'
```

Use a dedicated `OPENCLAW_TEAMSHIP_READ_TOKEN`. Do not reuse the ingestion token, Teamship password, or update-worker token. Keep `TEAMSHIP_BROWSER_READ_RUNTIME_ENABLED=false` on deployments that cannot run Chrome.

The OpenClaw process needs:

```bash
NEWL_APPS_BASE_URL='https://the-running-newl-apps-host'
OPENCLAW_TEAMSHIP_READ_TOKEN='<same dedicated token>'
```

## Tenant Activation

1. Sign in to Newl Apps as an administrator.
2. Confirm the Newl tenant has `ASSISTANT` and `SHIPMENT_DOCUMENTS` enabled.
3. In Settings -> Teamship WMS, keep Status `Active` and confirm the encrypted password is configured.
4. Upload the reviewed `teamship-approved-read-only-scopes.json` file. The server strictly validates every entry and records only the count in the configuration audit.
5. Confirm the page shows 87 configured scopes and Browser runtime `Ready`.
6. Enable `Nemo read-only Teamship searches` and save.
7. Do not enable scheduled Teamship daily-order sync unless that separate workflow is intended.

The tenant switch and browser runtime gate are independent. Both must be enabled for Inventory All, LPN, Receiving Order, and Product History browser reads. The API-backed shipping-order and shipping-eligible inventory routes still require the tenant switch and exact scope.

## OpenClaw Invocation

From the checked-out Newl Apps repository on the OpenClaw machine:

```bash
npm run openclaw:teamship-read -- \
  --user-email 'alex.newell@newl.ca' \
  -- 'Where is LPN 63991 customer 420 warehouse 102?'
```

The `x-newl-user-email` sent by the wrapper must come from the authenticated Teams/OpenClaw user, not from free-form prompt text. Newl Apps resolves that email to a current tenant membership before any Teamship access.

## Nemo Memory Contract

Use the curated files for procedural questions:

- `docs/wms/teamship/nemo/navigation.md`
- `docs/wms/teamship/nemo/inventory.md`
- `docs/wms/teamship/nemo/orders.md`
- `docs/wms/teamship/nemo/safety.md`

For a current SKU, LPN, shipping order, receiving order, or product-history question, invoke `npm run openclaw:teamship-read` with the authenticated employee email. Preserve the returned answer and sources. If the endpoint requests a customer ID, warehouse ID, or record identifier, ask the employee for it. Never infer a current record from documentation and never invoke files under `docs/wms/teamship/review/` as normal knowledge.

## Supervised Rollout

1. Start with Alex and one approved Garland/Annagem example per route.
2. Confirm every response includes a Newl Apps audit ID or a normalized disabled/error response.
3. Inspect `AuditLog` records for action names beginning `teamship.read.` and confirm no credentials or raw Teamship payloads are present.
4. Test a missing identifier, an unconfigured scope, an unauthorized employee, and a zero-result search.
5. Then test Faisal Haroon, Suzy Boreham, and Lily Morales using their authenticated Newl membership emails.

Disable either the tenant checkbox or `TEAMSHIP_BROWSER_READ_RUNTIME_ENABLED` to stop browser-backed reads. Removing or rotating `OPENCLAW_TEAMSHIP_READ_TOKEN` stops the OpenClaw endpoint.
