import { readFile } from "node:fs/promises";
import path from "node:path";

type SearchProfileResponse = {
  data?: {
    tenant?: {
      slug?: string;
      name?: string;
    };
    profiles?: Array<{
      id: string;
      name: string;
    }>;
  };
};

type JobRunCreateResponse = {
  data?: {
    jobRunId?: string;
    status?: string;
  };
};

type BatchResponse = {
  data?: {
    recordsCreated?: number;
    recordsUpdated?: number;
  };
};

type FixturePayload = {
  jobRunId?: string;
  searchProfileId?: string;
  source?: string;
  records?: unknown[];
};

async function main() {
  const baseUrl = requiredEnv("BASE_URL");
  const token = requiredEnv("INGESTION_API_TOKEN");
  const searchProfileIdOverride = process.env.SEARCH_PROFILE_ID?.trim() || null;
  const searchProfileNameOverride = process.env.SEARCH_PROFILE_NAME?.trim() || null;
  const fixturePath = process.env.TRADEMINING_FIXTURE_PATH?.trim() || null;

  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json"
  };

  console.log(`Using base URL: ${baseUrl}`);

  const profilesResponse = await fetchJson<SearchProfileResponse>(
    `${baseUrl}/api/integrations/trademining/search-profiles`,
    {
      method: "GET",
      headers
    }
  );

  const profilesBody = (profilesResponse.body ?? {}) as SearchProfileResponse;
  const profiles = profilesBody.data?.profiles ?? [];
  const tenant = profilesBody.data?.tenant;

  console.log("\nProfiles response");
  console.log(JSON.stringify({
    status: profilesResponse.status,
    tenant,
    profileCount: profiles.length,
    profiles: profiles.map((profile) => ({
      id: profile.id,
      name: profile.name
    }))
  }, null, 2));

  if (profiles.length === 0) {
    throw new Error("No enabled TradeMining search profiles were returned.");
  }

  const selectedProfile =
    (searchProfileIdOverride
      ? profiles.find((profile) => profile.id === searchProfileIdOverride)
      : null) ??
    (searchProfileNameOverride
      ? profiles.find((profile) => profile.name === searchProfileNameOverride)
      : null) ??
    profiles[0];

  if (!selectedProfile) {
    throw new Error("Unable to resolve a TradeMining search profile from the response.");
  }

  console.log(`\nSelected profile: ${selectedProfile.name} (${selectedProfile.id})`);

  const jobRunResponse = await fetchJson<JobRunCreateResponse>(
    `${baseUrl}/api/integrations/trademining/job-runs`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        source: "DIRECT_CONNECTOR",
        searchProfileId: selectedProfile.id,
        metadata: {
          runner: "scripts/smoke-test-trademining.ts",
          fixturePath: fixturePath ?? null
        }
      })
    }
  );

  const jobRunBody = (jobRunResponse.body ?? {}) as JobRunCreateResponse;
  const jobRunId = jobRunBody.data?.jobRunId;

  console.log("\nJob run response");
  console.log(JSON.stringify(jobRunResponse.body, null, 2));

  if (!jobRunId) {
    throw new Error("Job run creation succeeded but no jobRunId was returned.");
  }

  const batchPayload = fixturePath
    ? await loadFixturePayload(fixturePath, selectedProfile.id, jobRunId)
    : buildDefaultBatchPayload(selectedProfile.id, jobRunId);

  const batchResponse = await fetchJson(
    `${baseUrl}/api/integrations/trademining/batches`,
    {
      method: "POST",
      headers,
      body: JSON.stringify(batchPayload)
    }
  );

  console.log("\nBatch response");
  console.log(JSON.stringify(batchResponse.body, null, 2));
  const batchBody = (batchResponse.body ?? {}) as BatchResponse;

  const patchResponse = await fetchJson(
    `${baseUrl}/api/integrations/trademining/job-runs/${jobRunId}`,
    {
      method: "PATCH",
      headers,
      body: JSON.stringify({
        status: "COMPLETED",
        recordsProcessed: Array.isArray(batchPayload.records) ? batchPayload.records.length : 0,
        recordsCreated: batchBody.data?.recordsCreated ?? undefined,
        recordsUpdated: batchBody.data?.recordsUpdated ?? undefined,
        metadata: {
          runner: "scripts/smoke-test-trademining.ts"
        }
      })
    }
  );

  console.log("\nPatch response");
  console.log(JSON.stringify(patchResponse.body, null, 2));

  const readbackResponse = await fetchJson(
    `${baseUrl}/api/integrations/trademining/job-runs/${jobRunId}`,
    {
      method: "GET",
      headers
    }
  );

  console.log("\nReadback response");
  console.log(JSON.stringify(readbackResponse.body, null, 2));
}

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }

  return value.replace(/\/$/, "");
}

async function loadFixturePayload(
  fixturePath: string,
  searchProfileId: string,
  jobRunId: string
) {
  const absolutePath = path.isAbsolute(fixturePath)
    ? fixturePath
    : path.join(process.cwd(), fixturePath);
  const raw = await readFile(absolutePath, "utf8");
  const parsed = JSON.parse(raw) as FixturePayload;

  if (!Array.isArray(parsed.records) || parsed.records.length === 0) {
    throw new Error(`Fixture at ${absolutePath} does not contain a non-empty records array.`);
  }

  return {
    ...parsed,
    source: parsed.source ?? "DIRECT_CONNECTOR",
    searchProfileId,
    jobRunId
  };
}

function buildDefaultBatchPayload(searchProfileId: string, jobRunId: string) {
  const today = new Date().toISOString().slice(0, 10);

  return {
    jobRunId,
    searchProfileId,
    source: "DIRECT_CONNECTOR",
    records: [
      {
        importerName: "Smoke Test Imports LLC",
        consigneeName: "Smoke Test Imports LLC",
        masterConsigneeName: "Smoke Test Imports LLC",
        notifyParty: "Smoke Test Imports LLC",
        shipperName: "Shanghai Fixture Factory",
        masterShipperName: "Shanghai Fixture Factory",
        bolNumber: `SMOKE-${Date.now()}`,
        houseBolNumber: `HOUSE-${Date.now()}`,
        masterBolNumber: `MASTER-${Date.now()}`,
        containerNumber: "MSCU1234567",
        billType: "Ocean",
        shipmentDate: today,
        originCountry: "China",
        originPort: "Shanghai",
        foreignPort: "Shanghai",
        shipFromPort: "Shanghai",
        placeOfReceipt: "Shanghai",
        arrivalPort: "Houston, Texas",
        destinationPort: "Houston, Texas",
        destinationMarket: "Houston",
        destinationCity: "Houston",
        destinationState: "TX",
        destinationZip: "77001",
        productDescription: "office furniture",
        hsCode: "9403",
        containerCount: 1,
        teu: 1,
        weight: 18000,
        quantity: 120,
        volume: 25,
        carrier: "Smoke Test Carrier",
        vessel: "Smoke Test Vessel",
        voyage: "V001",
        rawData: {
          canonicalRecord: {
            importer_name: "Smoke Test Imports LLC",
            arrival_date: today,
            arrival_port: "Houston, Texas",
            foreign_port: "Shanghai",
            destination_market: "Houston",
            product_description: "office furniture",
            hs_code: "9403"
          },
          rawRow: {
            source: "smoke-test"
          }
        }
      }
    ]
  };
}

async function fetchJson<T>(url: string, init: RequestInit) {
  const response = await fetch(url, init);
  const text = await response.text();

  let body: T | Record<string, unknown> | null = null;

  try {
    body = text.length > 0 ? JSON.parse(text) : null;
  } catch {
    body = {
      rawText: text
    };
  }

  if (!response.ok) {
    throw new Error(`Request failed (${response.status}) ${url}\n${JSON.stringify(body, null, 2)}`);
  }

  return {
    status: response.status,
    body
  };
}

main().catch((error) => {
  console.error("\nTradeMining smoke test failed.");
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
