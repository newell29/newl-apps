# Newl Apps n8n Workflows

## Garland Email Intake Sync

Import `garland-email-intake-sync.workflow.json` into n8n to poll Newl Apps for Garland email intake every 15 minutes.

The workflow calls:

```text
POST /api/shipment-documents/teamship-review/email-intake/scheduled
```

Required n8n environment variables:

```bash
NEWL_APPS_BASE_URL=https://newl-apps.vercel.app
INGESTION_API_TOKEN=<same token configured in Vercel>
INGESTION_TENANT_SLUG=newl-group
```

Optional n8n environment variables:

```bash
GARLAND_EMAIL_LOOKBACK_DAYS=7
GARLAND_EMAIL_MAX_MESSAGES=100
```

Notes:

- The endpoint uses the same machine-auth pattern as the existing OpenClaw/n8n ingestion APIs.
- Business logic stays in Newl Apps; n8n only schedules and calls the endpoint.
- The workflow is safe to rerun because Newl Apps upserts exact Microsoft Graph messages/attachments and groups duplicate follow-up emails by PS range.
- Keep the workflow inactive until the Vercel deployment includes the scheduled endpoint and the production database migration for Garland email intake has run.
