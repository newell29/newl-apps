# OpenClaw/n8n Ingestion API

This document defines the first server-side API contract for VM-based OpenClaw and n8n orchestration.

OpenClaw currently remains on the Linux VM/server under the `openclaw` user. Do not move or rewrite OpenClaw as part of this milestone. Newl Apps owns configuration, ingestion records, candidate scoring, approvals, pipeline state, and audit history. OpenClaw and n8n should remain replaceable collectors/orchestrators that call Newl Apps APIs.

## Authentication

All endpoints require one of these headers:

```bash
Authorization: Bearer ${INGESTION_API_TOKEN}
```

or:

```bash
X-Newl-Ingestion-Key: ${INGESTION_API_TOKEN}
```

Required environment variables:

- `INGESTION_API_TOKEN`: long random token stored in local `.env` or deployment secrets. Never commit a real token.
- `INGESTION_TENANT_SLUG`: tenant slug the token is allowed to ingest for, such as `newl-group`.

This is a placeholder tenant-scoped token pattern. Production should replace it with tenant-scoped integration credential records or a managed secret store, while preserving the same tenant-resolution rule: the worker does not send arbitrary `tenantId` values.

## GET Active Search Profiles

`GET /api/integrations/trademining/search-profiles`

Returns only enabled TradeMining search profiles for the authenticated tenant.

Example:

```bash
curl -sS \
  -H "Authorization: Bearer ${INGESTION_API_TOKEN}" \
  "http://localhost:3000/api/integrations/trademining/search-profiles"
```

Response shape:

```json
{
  "data": {
    "tenant": {
      "slug": "newl-group",
      "name": "Newl Group"
    },
    "profiles": [
      {
        "id": "profile-id",
        "name": "Houston Import Leads",
        "description": "Sample profile for importers shipping into Houston-area demand signals.",
        "destinationMarkets": ["Houston", "Gulf Coast"],
        "destinationPorts": ["Houston, Texas", "Freeport, Texas"],
        "originPorts": ["Shanghai", "Ningbo", "Yantian"],
        "shipFromPorts": ["Shanghai", "Ningbo-Zhoushan"],
        "originCountries": ["China", "Vietnam", "India"],
        "productKeywords": ["furniture", "fixtures"],
        "hsCodes": ["9403"],
        "lookbackDays": 90,
        "minShipmentCount": 3,
        "minShipmentVolume": "25",
        "schedule": {
          "frequency": "daily",
          "timezone": "America/Toronto",
          "metadata": {
            "preferredRunHourLocal": 7
          }
        },
        "priorityWeight": 85
      }
    ]
  }
}
```

## POST Job Started

`POST /api/integrations/trademining/job-runs`

Creates an `AutomationJobRun` for the authenticated tenant and writes an audit event.

Example:

```bash
curl -sS \
  -X POST \
  -H "Authorization: Bearer ${INGESTION_API_TOKEN}" \
  -H "Content-Type: application/json" \
  "http://localhost:3000/api/integrations/trademining/job-runs" \
  -d '{
    "source": "OPENCLAW",
    "searchProfileId": "replace-with-profile-id",
    "metadata": {
      "vmHostname": "openclaw-vm-placeholder",
      "openclawRunId": "run-placeholder",
      "n8nExecutionId": null
    }
  }'
```

Response:

```json
{
  "data": {
    "jobRunId": "job-run-id",
    "status": "RUNNING"
  }
}
```

Accepted `source` values:

- `OPENCLAW`
- `N8N`
- `DIRECT_CONNECTOR`

## POST TradeMining Batch

`POST /api/integrations/trademining/batches`

Stores raw TradeMining records, normalizes company names, deduplicates companies by tenant, creates or updates `TradeMiningImportRecord` rows, and updates basic Candidate Feed scores. It does not create pipeline `Lead` records.

Example:

```bash
curl -sS \
  -X POST \
  -H "Authorization: Bearer ${INGESTION_API_TOKEN}" \
  -H "Content-Type: application/json" \
  "http://localhost:3000/api/integrations/trademining/batches" \
  --data @reference/examples/trademining-batch.json
```

Payload shape:

```json
{
  "jobRunId": "optional-job-run-id",
  "searchProfileId": "profile-id",
  "source": "OPENCLAW",
  "records": [
    {
      "importerName": "ABC IMPORTS INC",
      "supplierName": "XYZ MANUFACTURING",
      "bolNumber": "123456789",
      "shipmentDate": "2026-06-10",
      "originCountry": "China",
      "originPort": "Shanghai",
      "shipFromPort": "Shanghai",
      "destinationPort": "Houston, Texas",
      "destinationMarket": "Houston",
      "destinationCity": "Houston",
      "destinationState": "TX",
      "productDescription": "furniture and fixtures",
      "hsCode": "9403",
      "containerCount": 2,
      "weight": 18000,
      "volume": null,
      "rawData": {}
    }
  ]
}
```

Validation rules:

- `source` is required.
- `records` must be a non-empty array.
- Each record must include at least one of `importerName`, `consigneeName`, or `supplierName`.
- `searchProfileId`, when provided, must belong to the authenticated tenant.
- `jobRunId`, when provided, must belong to the authenticated tenant.
- Worker payload `tenantId` values are ignored; tenant identity is resolved server-side from the ingestion token configuration.

## PATCH Job Status

`PATCH /api/integrations/trademining/job-runs/:id`

Updates an existing tenant-owned job run and writes an audit event.

Example completed:

```bash
curl -sS \
  -X PATCH \
  -H "Authorization: Bearer ${INGESTION_API_TOKEN}" \
  -H "Content-Type: application/json" \
  "http://localhost:3000/api/integrations/trademining/job-runs/JOB_RUN_ID" \
  -d '{
    "status": "COMPLETED",
    "recordsProcessed": 125,
    "recordsCreated": 118,
    "recordsUpdated": 7,
    "metadata": {
      "vmHostname": "openclaw-vm-placeholder"
    }
  }'
```

Example failed:

```bash
curl -sS \
  -X PATCH \
  -H "Authorization: Bearer ${INGESTION_API_TOKEN}" \
  -H "Content-Type: application/json" \
  "http://localhost:3000/api/integrations/trademining/job-runs/JOB_RUN_ID" \
  -d '{
    "status": "FAILED",
    "errorMessage": "TradeMining export timed out.",
    "metadata": {
      "openclawRunId": "run-placeholder"
    }
  }'
```

Accepted external statuses:

- `RUNNING`
- `COMPLETED`
- `PARTIAL`
- `FAILED`
- `CANCELLED`

Because the current Prisma `JobStatus` enum does not include `PARTIAL`, partial completion is stored as `AutomationJobRun.status = SUCCESS` with `output.externalStatus = "PARTIAL"`.

## Local Mock Flow

1. Start Newl Apps locally:

```bash
npm run dev
```

2. Set local placeholders:

```bash
export INGESTION_API_TOKEN="local-dev-ingestion-token"
export BASE_URL="http://localhost:3000"
```

3. Fetch profiles:

```bash
curl -sS -H "Authorization: Bearer ${INGESTION_API_TOKEN}" \
  "${BASE_URL}/api/integrations/trademining/search-profiles"
```

4. Create a job run using one profile id from the response.

5. Replace `jobRunId` and `searchProfileId` in `reference/examples/trademining-batch.json`.

6. Post the batch:

```bash
curl -sS \
  -X POST \
  -H "Authorization: Bearer ${INGESTION_API_TOKEN}" \
  -H "Content-Type: application/json" \
  "${BASE_URL}/api/integrations/trademining/batches" \
  --data @reference/examples/trademining-batch.json
```

7. Mark the job completed with the PATCH endpoint.

## Architecture Notes

- Newl Apps owns profile configuration, ingestion persistence, candidate ranking, approvals, pipeline state, and audit history.
- OpenClaw should fetch enabled profiles, run TradeMining collection, and post results back.
- n8n may schedule or orchestrate jobs, but durable business logic should live server-side in Newl Apps.
- No live TradeMining, Apollo, Google Sheets, QuickBooks, UPS, or OpenClaw calls are made by these endpoints.
- Companies created by ingestion appear in Candidate Feed data and do not automatically enter the sales pipeline.
