const OPENAI_API_BASE_URL = "https://api.openai.com/v1";
const MAX_SHADOW_BATCH_SIZE = 4;

const IDENTITY_DISPOSITIONS = ["PASS", "AMBIGUOUS", "BLOCK"] as const;
const FRESHNESS_VALUES = ["FRESH", "CURRENT", "STALE", "NONE"] as const;
const OPERATING_REGIONS = ["NORTH_AMERICA", "CHINA", "OTHER_FOREIGN", "UNKNOWN"] as const;
const SERVICE_LINES = ["WAREHOUSING", "OCEAN_AIR", "TRUCKING"] as const;
const SIGNAL_TYPES = [
  "EXPANSION",
  "FACILITY_OPENING",
  "RETAIL_ROLLOUT",
  "HIRING",
  "LEADERSHIP_CHANGE",
  "LEASE_OR_CONSTRUCTION",
  "FUNDING_OR_ACQUISITION",
  "NEWS",
  "OTHER"
] as const;

export type HunterResearchShadowEvidence = {
  evidenceIndex: number;
  pass:
    | "IDENTITY"
    | "FRESH_EVENTS"
    | "CAREERS"
    | "DISTRIBUTION_FOOTPRINT"
    | "CUSTOMS_RECORDS"
    | "FOLLOW_UP";
  query: string;
  title: string;
  url: string;
  sourceDomain: string;
  sourceType: "FIRST_PARTY" | "GOVERNMENT" | "NEWS" | "CAREERS" | "DIRECTORY" | "OTHER";
  publishedAt: string | null;
  excerpt: string;
  firstParty: boolean;
};

export type HunterResearchShadowSynthesis = {
  companyKey: string;
  identityDisposition: typeof IDENTITY_DISPOSITIONS[number];
  identityConfidence: number;
  identityReason: string;
  logisticsProvider: boolean;
  namedExternalLogisticsProvider: boolean;
  stableExclusiveProviderEvidence: boolean;
  providerDisplacementEvidence: boolean;
  freshness: typeof FRESHNESS_VALUES[number];
  opportunitySummary: string;
  triggerEvidenceIndices: number[];
  geography: string | null;
  companyCountry: string | null;
  operatingRegion: typeof OPERATING_REGIONS[number];
  verifiedUsDivision: boolean;
  usDivisionName: string | null;
  usDivisionEvidenceIndices: number[];
  serviceLine: typeof SERVICE_LINES[number];
  signalType: typeof SIGNAL_TYPES[number];
  confidence: number;
  rationale: string;
  missingEvidence: string[];
  followUpQueries: string[];
};

export type HunterResearchShadowPacket = {
  companyId: string;
  companyKey: string;
  companyName: string;
  domain: string | null;
  priorityScore: number;
  primaryIndustry: string | null;
  shipmentEvidence: unknown[];
  existingSignals: unknown[];
  publicEvidence: HunterResearchShadowEvidence[];
  qwenSynthesis: HunterResearchShadowSynthesis | null;
};

export type HunterResearchShadowUsage = {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  totalTokens: number;
  durationMs: number;
};

export async function generateHunterResearchLunaShadow({
  model,
  promptVersion,
  packets,
  safetyIdentifier
}: {
  model: string;
  promptVersion: string;
  packets: HunterResearchShadowPacket[];
  safetyIdentifier: string;
}) {
  if (packets.length === 0 || packets.length > MAX_SHADOW_BATCH_SIZE) {
    throw new Error(`Luna synthesis batches must contain 1-${MAX_SHADOW_BATCH_SIZE} companies.`);
  }
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey || apiKey === "OPENAI_API_KEY_PLACEHOLDER") {
    throw new Error("OPENAI_API_KEY is not configured for Luna company research.");
  }
  if (model !== "gpt-5.6-luna") {
    throw new Error("Hunter company research is restricted to gpt-5.6-luna.");
  }

  const startedAt = Date.now();
  const independentPackets = packets.map((packet) => ({
    companyId: packet.companyId,
    companyKey: packet.companyKey,
    companyName: packet.companyName,
    domain: packet.domain,
    priorityScore: packet.priorityScore,
    primaryIndustry: packet.primaryIndustry,
    shipmentEvidence: packet.shipmentEvidence,
    existingSignals: packet.existingSignals,
    publicEvidence: packet.publicEvidence
  }));
  const response = await fetch(`${OPENAI_API_BASE_URL}/responses`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      store: false,
      safety_identifier: safetyIdentifier,
      reasoning: {
        effort: "low"
      },
      max_output_tokens: 16_000,
      input: [
        {
          role: "system",
          content: companyResearchSystemPrompt()
        },
        {
          role: "user",
          content:
            `Prompt version: ${promptVersion}\n` +
            "Produce the authoritative research synthesis for every supplied company using only the supplied evidence. " +
            "Return one companies row for every companyKey. The local Qwen assessment is deliberately not " +
            "included in this model input; Newl Apps compares the independent rows after your response. " +
            "Do not browse, call tools, or invent facts.\n\n" +
            JSON.stringify(independentPackets)
        }
      ],
      text: {
        verbosity: "low",
        format: {
          type: "json_schema",
          name: "hunter_company_research_synthesis",
          strict: true,
          schema: HUNTER_RESEARCH_SHADOW_SCHEMA
        }
      }
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(90_000)
  });

  const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok || !payload) {
    throw new Error(
      extractOpenAiError(payload) ??
        `OpenAI Luna company-research request failed with status ${response.status}.`
    );
  }
  if (payload.status !== "completed") {
    const reason = readIncompleteReason(payload);
    throw new Error(
      reason
        ? `OpenAI Luna company-research response was incomplete: ${reason}.`
        : "OpenAI Luna company-research response did not complete."
    );
  }
  if (hasRefusal(payload)) {
    throw new Error("OpenAI Luna declined the company-research request.");
  }

  const parsed = JSON.parse(readResponsesOutputText(payload)) as unknown;
  const rows = validateHunterResearchShadowResponse(parsed, packets);
  const usage = readUsage(payload, Date.now() - startedAt);
  return { rows, usage };
}

export function validateHunterResearchShadowResponse(
  value: unknown,
  packets: HunterResearchShadowPacket[]
): HunterResearchShadowSynthesis[] {
  const root = asRecord(value, "Luna synthesis response");
  const companies = asArray(root.companies, "Luna synthesis response companies");
  if (companies.length !== packets.length) {
    throw new Error("OpenAI Luna did not return exactly one row for every research company.");
  }
  const packetByKey = new Map(packets.map((packet) => [packet.companyKey, packet]));
  const returnedKeys = new Set<string>();
  const rows = companies.map((value, index) => {
    const row = asRecord(value, `Luna synthesis company ${index}`);
    const companyKey = boundedString(row.companyKey, 300, `Luna synthesis company ${index} key`);
    const packet = packetByKey.get(companyKey);
    if (!packet || returnedKeys.has(companyKey)) {
      throw new Error("OpenAI Luna returned an unknown or duplicate companyKey.");
    }
    returnedKeys.add(companyKey);
    const availableEvidence = new Set(packet.publicEvidence.map((item) => item.evidenceIndex));
    const triggerEvidenceIndices = boundedEvidenceIndices(
      row.triggerEvidenceIndices,
      availableEvidence,
      1,
      5,
      `${companyKey} trigger evidence`
    );
    const verifiedUsDivision = booleanValue(row.verifiedUsDivision, `${companyKey} verifiedUsDivision`);
    const usDivisionName = nullableString(row.usDivisionName, 300, `${companyKey} usDivisionName`);
    const usDivisionEvidenceIndices = boundedEvidenceIndices(
      row.usDivisionEvidenceIndices,
      availableEvidence,
      0,
      5,
      `${companyKey} U.S. division evidence`
    );
    if (verifiedUsDivision && (!usDivisionName || usDivisionEvidenceIndices.length === 0)) {
      throw new Error(`OpenAI Luna did not name and cite the verified U.S. division for ${companyKey}.`);
    }
    if (!verifiedUsDivision && (usDivisionName || usDivisionEvidenceIndices.length > 0)) {
      throw new Error(`OpenAI Luna cited a U.S. division without verifying one for ${companyKey}.`);
    }
    return {
      companyKey,
      identityDisposition: enumValue(
        row.identityDisposition,
        IDENTITY_DISPOSITIONS,
        `${companyKey} identityDisposition`
      ),
      identityConfidence: boundedInteger(
        row.identityConfidence,
        0,
        100,
        `${companyKey} identityConfidence`
      ),
      identityReason: boundedString(row.identityReason, 1_000, `${companyKey} identityReason`),
      logisticsProvider: booleanValue(row.logisticsProvider, `${companyKey} logisticsProvider`),
      namedExternalLogisticsProvider: booleanValue(
        row.namedExternalLogisticsProvider,
        `${companyKey} namedExternalLogisticsProvider`
      ),
      stableExclusiveProviderEvidence: booleanValue(
        row.stableExclusiveProviderEvidence,
        `${companyKey} stableExclusiveProviderEvidence`
      ),
      providerDisplacementEvidence: booleanValue(
        row.providerDisplacementEvidence,
        `${companyKey} providerDisplacementEvidence`
      ),
      freshness: enumValue(row.freshness, FRESHNESS_VALUES, `${companyKey} freshness`),
      opportunitySummary: boundedString(
        row.opportunitySummary,
        2_000,
        `${companyKey} opportunitySummary`
      ),
      triggerEvidenceIndices,
      geography: nullableString(row.geography, 300, `${companyKey} geography`),
      companyCountry: nullableString(row.companyCountry, 200, `${companyKey} companyCountry`),
      operatingRegion: enumValue(
        row.operatingRegion,
        OPERATING_REGIONS,
        `${companyKey} operatingRegion`
      ),
      verifiedUsDivision,
      usDivisionName,
      usDivisionEvidenceIndices,
      serviceLine: enumValue(row.serviceLine, SERVICE_LINES, `${companyKey} serviceLine`),
      signalType: enumValue(row.signalType, SIGNAL_TYPES, `${companyKey} signalType`),
      confidence: boundedInteger(row.confidence, 0, 100, `${companyKey} confidence`),
      rationale: boundedString(row.rationale, 2_000, `${companyKey} rationale`),
      missingEvidence: boundedStringArray(
        row.missingEvidence,
        10,
        300,
        `${companyKey} missingEvidence`
      ),
      followUpQueries: boundedStringArray(
        row.followUpQueries,
        2,
        500,
        `${companyKey} followUpQueries`
      )
    };
  });
  if (returnedKeys.size !== packetByKey.size) {
    throw new Error("OpenAI Luna omitted one or more shadow companies.");
  }
  return rows;
}

const HUNTER_RESEARCH_SHADOW_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    companies: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          companyKey: { type: "string" },
          identityDisposition: { type: "string", enum: IDENTITY_DISPOSITIONS },
          identityConfidence: { type: "integer", minimum: 0, maximum: 100 },
          identityReason: { type: "string" },
          logisticsProvider: { type: "boolean" },
          namedExternalLogisticsProvider: { type: "boolean" },
          stableExclusiveProviderEvidence: { type: "boolean" },
          providerDisplacementEvidence: { type: "boolean" },
          freshness: { type: "string", enum: FRESHNESS_VALUES },
          opportunitySummary: { type: "string" },
          triggerEvidenceIndices: {
            type: "array",
            items: { type: "integer", minimum: 0 },
            minItems: 1,
            maxItems: 5
          },
          geography: { type: ["string", "null"] },
          companyCountry: { type: ["string", "null"] },
          operatingRegion: { type: "string", enum: OPERATING_REGIONS },
          verifiedUsDivision: { type: "boolean" },
          usDivisionName: { type: ["string", "null"] },
          usDivisionEvidenceIndices: {
            type: "array",
            items: { type: "integer", minimum: 0 },
            maxItems: 5
          },
          serviceLine: { type: "string", enum: SERVICE_LINES },
          signalType: { type: "string", enum: SIGNAL_TYPES },
          confidence: { type: "integer", minimum: 0, maximum: 100 },
          rationale: { type: "string" },
          missingEvidence: {
            type: "array",
            items: { type: "string" },
            maxItems: 10
          },
          followUpQueries: {
            type: "array",
            items: { type: "string" },
            maxItems: 2
          }
        },
        required: [
          "companyKey",
          "identityDisposition",
          "identityConfidence",
          "identityReason",
          "logisticsProvider",
          "namedExternalLogisticsProvider",
          "stableExclusiveProviderEvidence",
          "providerDisplacementEvidence",
          "freshness",
          "opportunitySummary",
          "triggerEvidenceIndices",
          "geography",
          "companyCountry",
          "operatingRegion",
          "verifiedUsDivision",
          "usDivisionName",
          "usDivisionEvidenceIndices",
          "serviceLine",
          "signalType",
          "confidence",
          "rationale",
          "missingEvidence",
          "followUpQueries"
        ]
      }
    }
  },
  required: ["companies"]
};

function companyResearchSystemPrompt() {
  return (
    "You are Luna, the authoritative evidence-synthesis stage for Hunter company research. " +
    "Use only supplied publicEvidence, shipmentEvidence, and existingSignals. Never infer facts from a URL, " +
    "company name, search query, shipment origin, or Qwen synthesis. Confirm the exact operating company and " +
    "distinguish it from parents, siblings, locations, logistics providers, and ambiguous aliases. " +
    "A manufacturer, retailer, importer, or distributor with internal logistics staff remains a prospect; " +
    "logisticsProvider is true only when supplied evidence says it sells logistics services to others. " +
    "namedExternalLogisticsProvider and stableExclusiveProviderEvidence require explicit evidence, and " +
    "providerDisplacementEvidence requires explicit change, dissatisfaction, overflow, bid, or replacement evidence. " +
    "FRESH requires a material exact-company event with a supplied publication date in the trailing 18 months. " +
    "CURRENT means supported operating footprint or a specific currently open role without a discrete recent trigger. " +
    "STALE and NONE must not be described as near-term demand. Trigger indices must cite the supplied evidenceIndex " +
    "values that directly support the summary. Directories and generic profiles cannot create a fresh trigger. " +
    "A current vacancy requires explicit opening, hiring, or application language for that exact role; salary records, " +
    "employee profiles, generic careers invitations, talent communities, and expired postings do not qualify. " +
    "Determine companyCountry and operatingRegion only from public identity evidence about the company or verified " +
    "parent, never from shipment origin, foreign ports, products, or routing. verifiedUsDivision requires explicit " +
    "public evidence of the same company's named U.S. subsidiary, division, branch, facility, or operation. " +
    "Identity and opportunity confidence measure evidence reliability rather than sales enthusiasm. " +
    "Return exact schema data with no prose outside the structured response."
  );
}

function readUsage(payload: Record<string, unknown>, durationMs: number): HunterResearchShadowUsage {
  const usage = isRecord(payload.usage) ? payload.usage : {};
  const inputDetails = isRecord(usage.input_tokens_details) ? usage.input_tokens_details : {};
  const inputTokens = nonNegativeInteger(usage.input_tokens);
  const outputTokens = nonNegativeInteger(usage.output_tokens);
  return {
    inputTokens,
    cachedInputTokens: nonNegativeInteger(inputDetails.cached_tokens),
    outputTokens,
    totalTokens: nonNegativeInteger(usage.total_tokens) || inputTokens + outputTokens,
    durationMs
  };
}

function readResponsesOutputText(payload: Record<string, unknown>) {
  if (typeof payload.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text.trim();
  }
  const output = Array.isArray(payload.output) ? payload.output : [];
  for (const item of output) {
    if (!isRecord(item) || !Array.isArray(item.content)) continue;
    for (const part of item.content) {
      if (!isRecord(part)) continue;
      if (typeof part.text === "string" && part.text.trim()) return part.text.trim();
    }
  }
  throw new Error("OpenAI Luna returned no structured company-research output.");
}

function hasRefusal(payload: Record<string, unknown>) {
  const output = Array.isArray(payload.output) ? payload.output : [];
  return output.some(
    (item) =>
      isRecord(item) &&
      Array.isArray(item.content) &&
      item.content.some((part) => isRecord(part) && part.type === "refusal")
  );
}

function readIncompleteReason(payload: Record<string, unknown>) {
  const details = isRecord(payload.incomplete_details) ? payload.incomplete_details : {};
  return typeof details.reason === "string" && details.reason.trim()
    ? details.reason.trim().slice(0, 200)
    : null;
}

function extractOpenAiError(payload: Record<string, unknown> | null) {
  if (!payload || !isRecord(payload.error)) return null;
  const message = payload.error.message;
  return typeof message === "string" && message.trim()
    ? message.trim().slice(0, 500)
    : null;
}

function boundedEvidenceIndices(
  value: unknown,
  available: Set<number>,
  minimumItems: number,
  maximumItems: number,
  label: string
) {
  const items = asArray(value, label);
  if (items.length < minimumItems || items.length > maximumItems) {
    throw new Error(`${label} must contain ${minimumItems}-${maximumItems} items.`);
  }
  const indices = items.map((item) => boundedInteger(item, 0, 23, label));
  if (new Set(indices).size !== indices.length || indices.some((index) => !available.has(index))) {
    throw new Error(`${label} contains a duplicate or unavailable evidence index.`);
  }
  return indices;
}

function boundedStringArray(
  value: unknown,
  maximumItems: number,
  maximumLength: number,
  label: string
) {
  const items = asArray(value, label);
  if (items.length > maximumItems) throw new Error(`${label} contains too many items.`);
  return items.map((item, index) => boundedString(item, maximumLength, `${label}[${index}]`));
}

function enumValue<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
  label: string
): T[number] {
  if (typeof value !== "string" || !allowed.includes(value as T[number])) {
    throw new Error(`${label} is invalid.`);
  }
  return value as T[number];
}

function boundedInteger(value: unknown, minimum: number, maximum: number, label: string) {
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new Error(`${label} must be an integer between ${minimum} and ${maximum}.`);
  }
  return value as number;
}

function boundedString(value: unknown, maximumLength: number, label: string) {
  if (typeof value !== "string" || !value.trim() || value.length > maximumLength) {
    throw new Error(`${label} must be a non-empty string no longer than ${maximumLength} characters.`);
  }
  return value.trim();
}

function nullableString(value: unknown, maximumLength: number, label: string) {
  if (value === null) return null;
  return boundedString(value, maximumLength, label);
}

function booleanValue(value: unknown, label: string) {
  if (typeof value !== "boolean") throw new Error(`${label} must be a boolean.`);
  return value;
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${label} must be an object.`);
  return value;
}

function asArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function nonNegativeInteger(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : 0;
}
