import { createHash } from "node:crypto";

import { JobStatus, Prisma } from "@prisma/client";

import {
  generateHunterResearchLunaShadow,
  type HunterResearchShadowEvidence,
  type HunterResearchShadowPacket,
  type HunterResearchShadowSynthesis,
  type HunterResearchShadowUsage,
  validateHunterResearchShadowResponse
} from "@/server/integrations/openai-hunter-research-shadow";
import { prisma } from "@/server/db";
import { HUNTER_COMPANY_RESEARCH_JOB_TYPE } from "@/modules/lead-gen/hunter-job-types";

export const HUNTER_COMPANY_RESEARCH_LUNA_SHADOW_MODEL = "gpt-5.6-luna";
export const HUNTER_COMPANY_RESEARCH_LUNA_SHADOW_PROMPT_VERSION =
  "hunter-company-research-v15-luna-shadow-v1";

const MAX_SHADOW_BATCH_SIZE = 4;
const MAX_PACKET_JSON_CHARS = 120_000;
const COMPARISON_FIELDS = [
  "identityDisposition",
  "logisticsProvider",
  "namedExternalLogisticsProvider",
  "stableExclusiveProviderEvidence",
  "providerDisplacementEvidence",
  "freshness",
  "operatingRegion",
  "verifiedUsDivision",
  "serviceLine",
  "signalType"
] as const;

type StoredShadowBatch = {
  batchId: string;
  companyIds: string[];
  qwenCompanyIds: string[];
  status: "SUCCESS" | "ERROR";
  usage: HunterResearchShadowUsage | null;
  errorMessage: string | null;
  completedAt: string;
};

type StoredShadowResult = {
  companyId: string;
  companyKey: string;
  qwen: HunterResearchShadowSynthesis | null;
  luna: HunterResearchShadowSynthesis;
  comparison: {
    comparedFieldCount: number;
    agreementCount: number;
    agreementPercent: number;
    disagreedFields: string[];
    triggerEvidenceOverlap: number[];
    triggerEvidenceAgreement: boolean;
    confidenceDifference: number;
    identityConfidenceDifference: number;
  } | null;
};

export type StoredHunterResearchLunaShadow = {
  version: 1;
  status: "RUNNING" | "SUCCESS" | "PARTIAL" | "ERROR";
  authoritative: false;
  model: string;
  promptVersion: string;
  expectedCompanyCount: number;
  evaluatedCompanyCount: number;
  firstPassSchemaValidCompanyCount: number;
  qwenSynthesisCompanyCount: number;
  qwenMissingCompanyCount: number;
  failedBatchCount: number;
  categoricalAgreementPercent: number | null;
  triggerEvidenceAgreementCount: number;
  usage: HunterResearchShadowUsage;
  batches: StoredShadowBatch[];
  results: StoredShadowResult[];
  completedAt: string | null;
};

export function hunterResearchLunaShadowConfiguration() {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  const enabled =
    process.env.HUNTER_COMPANY_RESEARCH_LUNA_SHADOW_ENABLED?.trim().toLowerCase() === "true";
  return {
    enabled: enabled && Boolean(apiKey && apiKey !== "OPENAI_API_KEY_PLACEHOLDER"),
    requested: enabled,
    provider: "OPENAI" as const,
    recommended: HUNTER_COMPANY_RESEARCH_LUNA_SHADOW_MODEL,
    promptVersion: HUNTER_COMPANY_RESEARCH_LUNA_SHADOW_PROMPT_VERSION,
    structuredOutput: true,
    reasoningEffort: "LOW" as const,
    authoritative: false
  };
}

export async function runHunterResearchLunaShadowBatch({
  tenantId,
  runId,
  packets: rawPackets,
  finalBatch
}: {
  tenantId: string;
  runId: string;
  packets: unknown;
  finalBatch: boolean;
}) {
  const configuration = hunterResearchLunaShadowConfiguration();
  if (!configuration.enabled) {
    return {
      state: "disabled" as const,
      message: configuration.requested
        ? "Luna shadow was requested but the server OpenAI runtime is not configured."
        : "Luna shadow is disabled."
    };
  }

  const run = await prisma.automationJobRun.findFirst({
    where: {
      id: runId,
      tenantId,
      jobType: HUNTER_COMPANY_RESEARCH_JOB_TYPE,
      status: JobStatus.RUNNING
    },
    select: { id: true, input: true, output: true }
  });
  if (!run) throw new Error("Hunter company-research shadow run is not active for this tenant.");

  const input = asRecord(run.input, "Hunter company-research run input");
  const expectedCompanyIds = stringArray(
    input.candidateCompanyIds,
    100,
    "Hunter company-research candidate IDs"
  );
  const expectedCompanyKeys = stringArray(
    input.candidateCompanyKeys,
    100,
    "Hunter company-research candidate keys"
  );
  if (expectedCompanyIds.length !== expectedCompanyKeys.length) {
    throw new Error("Hunter company-research run has inconsistent candidate identity metadata.");
  }
  const expectedKeyById = new Map(
    expectedCompanyIds.map((companyId, index) => [companyId, expectedCompanyKeys[index]!])
  );
  const packets = parseShadowPackets(rawPackets);
  const packetIds = packets.map((packet) => packet.companyId);
  if (
    packets.some((packet) => expectedKeyById.get(packet.companyId) !== packet.companyKey) ||
    new Set(packetIds).size !== packetIds.length
  ) {
    throw new Error("Luna shadow batch contains a company outside the prepared tenant cohort.");
  }

  const tenantCompanies = await prisma.company.findMany({
    where: {
      tenantId,
      id: { in: packetIds }
    },
    select: { id: true, name: true, normalizedName: true }
  });
  const tenantCompanyById = new Map(tenantCompanies.map((company) => [company.id, company]));
  if (
    tenantCompanies.length !== packets.length ||
    packets.some((packet) => {
      const company = tenantCompanyById.get(packet.companyId);
      return (
        !company ||
        company.normalizedName !== packet.companyKey ||
        company.name !== packet.companyName
      );
    })
  ) {
    throw new Error("Luna shadow batch failed tenant or company identity validation.");
  }

  const batchId = createHash("sha256")
    .update([
      HUNTER_COMPANY_RESEARCH_LUNA_SHADOW_PROMPT_VERSION,
      HUNTER_COMPANY_RESEARCH_LUNA_SHADOW_MODEL,
      ...packetIds
    ].join("|"))
    .digest("hex")
    .slice(0, 24);
  const existing = readStoredHunterResearchLunaShadow(run.output);
  const cachedBatch = existing?.batches.find(
    (batch) => batch.batchId === batchId && batch.status === "SUCCESS"
  );
  if (cachedBatch) {
    return {
      state: "cached" as const,
      batchId,
      report: summarizeHunterResearchLunaShadow(existing)
    };
  }

  try {
    const generated = await generateHunterResearchLunaShadow({
      model: HUNTER_COMPANY_RESEARCH_LUNA_SHADOW_MODEL,
      promptVersion: HUNTER_COMPANY_RESEARCH_LUNA_SHADOW_PROMPT_VERSION,
      packets,
      safetyIdentifier: createHash("sha256").update(tenantId).digest("hex")
    });
    const lunaByKey = new Map(generated.rows.map((row) => [row.companyKey, row]));
    const results = packets.map((packet) => ({
      companyId: packet.companyId,
      companyKey: packet.companyKey,
      qwen: packet.qwenSynthesis,
      luna: lunaByKey.get(packet.companyKey)!,
      comparison: packet.qwenSynthesis
        ? compareSynthesis(packet.qwenSynthesis, lunaByKey.get(packet.companyKey)!)
        : null
    }));
    const report = mergeShadowReport({
      existing,
      expectedCompanyCount: expectedCompanyIds.length,
      batch: {
        batchId,
        companyIds: packetIds,
        qwenCompanyIds: packets
          .filter((packet) => packet.qwenSynthesis !== null)
          .map((packet) => packet.companyId),
        status: "SUCCESS",
        usage: generated.usage,
        errorMessage: null,
        completedAt: new Date().toISOString()
      },
      results,
      finalBatch
    });
    await persistShadowReport({ tenantId, runId, report });
    if (finalBatch) {
      await prisma.auditLog.create({
        data: {
          tenantId,
          action: "lead-gen.hunter-company-research.luna-shadow-completed",
          entityType: "AutomationJobRun",
          entityId: runId,
          after: summarizeHunterResearchLunaShadow(report) ?? {}
        }
      });
    }
    return {
      state: "completed" as const,
      batchId,
      report: summarizeHunterResearchLunaShadow(report)
    };
  } catch (error) {
    const errorMessage = safeErrorMessage(error);
    const report = mergeShadowReport({
      existing,
      expectedCompanyCount: expectedCompanyIds.length,
      batch: {
        batchId,
        companyIds: packetIds,
        qwenCompanyIds: packets
          .filter((packet) => packet.qwenSynthesis !== null)
          .map((packet) => packet.companyId),
        status: "ERROR",
        usage: null,
        errorMessage,
        completedAt: new Date().toISOString()
      },
      results: [],
      finalBatch
    });
    await persistShadowReport({ tenantId, runId, report });
    return {
      state: "error" as const,
      batchId,
      errorMessage,
      report: summarizeHunterResearchLunaShadow(report)
    };
  }
}

export function readStoredHunterResearchLunaShadow(
  value: Prisma.JsonValue | null | undefined
): StoredHunterResearchLunaShadow | null {
  if (!isRecord(value) || !isRecord(value.lunaShadow)) return null;
  const shadow = value.lunaShadow;
  if (shadow.version !== 1 || shadow.authoritative !== false) return null;
  const batches = Array.isArray(shadow.batches)
    ? shadow.batches.filter(isStoredBatch)
    : [];
  const results = Array.isArray(shadow.results)
    ? shadow.results.filter(isStoredResult)
    : [];
  return {
    version: 1,
    status: shadowStatus(shadow.status),
    authoritative: false,
    model: stringOr(shadow.model, HUNTER_COMPANY_RESEARCH_LUNA_SHADOW_MODEL),
    promptVersion: stringOr(
      shadow.promptVersion,
      HUNTER_COMPANY_RESEARCH_LUNA_SHADOW_PROMPT_VERSION
    ),
    expectedCompanyCount: nonNegativeInteger(shadow.expectedCompanyCount),
    evaluatedCompanyCount: results.length,
    firstPassSchemaValidCompanyCount: results.length,
    qwenSynthesisCompanyCount: nonNegativeInteger(shadow.qwenSynthesisCompanyCount),
    qwenMissingCompanyCount: nonNegativeInteger(shadow.qwenMissingCompanyCount),
    failedBatchCount: batches.filter((batch) => batch.status === "ERROR").length,
    categoricalAgreementPercent: nullableNumber(shadow.categoricalAgreementPercent),
    triggerEvidenceAgreementCount: nonNegativeInteger(shadow.triggerEvidenceAgreementCount),
    usage: readStoredUsage(shadow.usage),
    batches,
    results,
    completedAt: typeof shadow.completedAt === "string" ? shadow.completedAt : null
  };
}

export function summarizeHunterResearchLunaShadow(
  report: StoredHunterResearchLunaShadow | null
) {
  if (!report) return null;
  return {
    status: report.status,
    authoritative: false as const,
    model: report.model,
    expectedCompanyCount: report.expectedCompanyCount,
    evaluatedCompanyCount: report.evaluatedCompanyCount,
    firstPassSchemaValidCompanyCount: report.firstPassSchemaValidCompanyCount,
    qwenSynthesisCompanyCount: report.qwenSynthesisCompanyCount,
    qwenMissingCompanyCount: report.qwenMissingCompanyCount,
    failedBatchCount: report.failedBatchCount,
    categoricalAgreementPercent: report.categoricalAgreementPercent,
    triggerEvidenceAgreementCount: report.triggerEvidenceAgreementCount,
    inputTokens: report.usage.inputTokens,
    cachedInputTokens: report.usage.cachedInputTokens,
    outputTokens: report.usage.outputTokens,
    durationMs: report.usage.durationMs
  };
}

function parseShadowPackets(value: unknown): HunterResearchShadowPacket[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_SHADOW_BATCH_SIZE) {
    throw new Error(`Luna shadow packets must contain 1-${MAX_SHADOW_BATCH_SIZE} companies.`);
  }
  return value.map((item, index) => {
    const packet = asRecord(item, `Luna shadow packet ${index}`);
    const companyId = boundedString(packet.companyId, 200, `Luna shadow packet ${index} companyId`);
    const companyKey = boundedString(
      packet.companyKey,
      300,
      `Luna shadow packet ${index} companyKey`
    );
    const companyName = boundedString(
      packet.companyName,
      500,
      `Luna shadow packet ${index} companyName`
    );
    const publicEvidence = parsePublicEvidence(packet.publicEvidence, companyKey);
    const basePacket: HunterResearchShadowPacket = {
      companyId,
      companyKey,
      companyName,
      domain: nullableBoundedString(packet.domain, 500, `${companyKey} domain`),
      priorityScore: boundedInteger(packet.priorityScore, 0, 100, `${companyKey} priorityScore`),
      primaryIndustry: nullableBoundedString(
        packet.primaryIndustry,
        300,
        `${companyKey} primaryIndustry`
      ),
      shipmentEvidence: boundedJsonArray(packet.shipmentEvidence, 8, `${companyKey} shipmentEvidence`),
      existingSignals: boundedJsonArray(packet.existingSignals, 5, `${companyKey} existingSignals`),
      publicEvidence,
      qwenSynthesis: null
    };
    const qwenSynthesis = packet.qwenSynthesis === null
      ? null
      : validateHunterResearchShadowResponse(
          { companies: [packet.qwenSynthesis] },
          [basePacket]
        )[0]!;
    const parsed: HunterResearchShadowPacket = {
      ...basePacket,
      qwenSynthesis
    };
    if (JSON.stringify(parsed).length > MAX_PACKET_JSON_CHARS) {
      throw new Error(`${companyKey} Luna shadow packet is too large.`);
    }
    return parsed;
  });
}

function parsePublicEvidence(value: unknown, companyKey: string): HunterResearchShadowEvidence[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 5) {
    throw new Error(`${companyKey} Luna shadow evidence must contain 1-5 records.`);
  }
  const seenIndices = new Set<number>();
  return value.map((item, index) => {
    const evidence = asRecord(item, `${companyKey} evidence ${index}`);
    const evidenceIndex = boundedInteger(
      evidence.evidenceIndex,
      0,
      23,
      `${companyKey} evidenceIndex`
    );
    if (seenIndices.has(evidenceIndex)) throw new Error(`${companyKey} has duplicate evidence indices.`);
    seenIndices.add(evidenceIndex);
    const url = boundedString(evidence.url, 2_000, `${companyKey} evidence URL`);
    if (!url.startsWith("https://")) throw new Error(`${companyKey} evidence URL must use HTTPS.`);
    return {
      evidenceIndex,
      pass: enumString(
        evidence.pass,
        ["IDENTITY", "FRESH_EVENTS", "CAREERS", "DISTRIBUTION_FOOTPRINT", "FOLLOW_UP"] as const,
        `${companyKey} evidence pass`
      ),
      query: boundedString(evidence.query, 500, `${companyKey} evidence query`),
      title: boundedString(evidence.title, 500, `${companyKey} evidence title`),
      url,
      sourceDomain: boundedString(
        evidence.sourceDomain,
        300,
        `${companyKey} evidence sourceDomain`
      ),
      sourceType: enumString(
        evidence.sourceType,
        ["FIRST_PARTY", "GOVERNMENT", "NEWS", "CAREERS", "DIRECTORY", "OTHER"] as const,
        `${companyKey} evidence sourceType`
      ),
      publishedAt: nullableBoundedString(
        evidence.publishedAt,
        100,
        `${companyKey} evidence publishedAt`
      ),
      excerpt: boundedString(evidence.excerpt, 1_000, `${companyKey} evidence excerpt`),
      firstParty: booleanValue(evidence.firstParty, `${companyKey} evidence firstParty`)
    };
  });
}

function compareSynthesis(
  qwen: HunterResearchShadowSynthesis,
  luna: HunterResearchShadowSynthesis
): StoredShadowResult["comparison"] {
  const disagreedFields = COMPARISON_FIELDS.filter((field) => qwen[field] !== luna[field]);
  const qwenIndices = new Set(qwen.triggerEvidenceIndices);
  const triggerEvidenceOverlap = luna.triggerEvidenceIndices.filter((index) => qwenIndices.has(index));
  const agreementCount = COMPARISON_FIELDS.length - disagreedFields.length;
  return {
    comparedFieldCount: COMPARISON_FIELDS.length,
    agreementCount,
    agreementPercent: Math.round((agreementCount / COMPARISON_FIELDS.length) * 100),
    disagreedFields,
    triggerEvidenceOverlap,
    triggerEvidenceAgreement: triggerEvidenceOverlap.length > 0,
    confidenceDifference: luna.confidence - qwen.confidence,
    identityConfidenceDifference: luna.identityConfidence - qwen.identityConfidence
  };
}

function mergeShadowReport({
  existing,
  expectedCompanyCount,
  batch,
  results,
  finalBatch
}: {
  existing: StoredHunterResearchLunaShadow | null;
  expectedCompanyCount: number;
  batch: StoredShadowBatch;
  results: StoredShadowResult[];
  finalBatch: boolean;
}): StoredHunterResearchLunaShadow {
  const batches = [
    ...(existing?.batches ?? []).filter((item) => item.batchId !== batch.batchId),
    batch
  ];
  const replacedIds = new Set(results.map((result) => result.companyId));
  const mergedResults = [
    ...(existing?.results ?? []).filter((result) => !replacedIds.has(result.companyId)),
    ...results
  ].sort((left, right) => left.companyKey.localeCompare(right.companyKey));
  const qwenCompanyIds = new Set(batches.flatMap((item) => item.qwenCompanyIds));
  const successfulUsage = batches.reduce(
    (total, item) => addUsage(total, item.usage),
    emptyUsage()
  );
  const comparedFields = mergedResults.reduce(
    (sum, result) => sum + (result.comparison?.comparedFieldCount ?? 0),
    0
  );
  const agreements = mergedResults.reduce(
    (sum, result) => sum + (result.comparison?.agreementCount ?? 0),
    0
  );
  const failedBatchCount = batches.filter((item) => item.status === "ERROR").length;
  const status = finalBatch
    ? mergedResults.length === expectedCompanyCount && failedBatchCount === 0
      ? "SUCCESS"
      : mergedResults.length > 0
        ? "PARTIAL"
        : "ERROR"
    : "RUNNING";
  return {
    version: 1,
    status,
    authoritative: false,
    model: HUNTER_COMPANY_RESEARCH_LUNA_SHADOW_MODEL,
    promptVersion: HUNTER_COMPANY_RESEARCH_LUNA_SHADOW_PROMPT_VERSION,
    expectedCompanyCount,
    evaluatedCompanyCount: mergedResults.length,
    firstPassSchemaValidCompanyCount: mergedResults.length,
    qwenSynthesisCompanyCount: qwenCompanyIds.size,
    qwenMissingCompanyCount: Math.max(0, expectedCompanyCount - qwenCompanyIds.size),
    failedBatchCount,
    categoricalAgreementPercent:
      comparedFields > 0 ? Math.round((agreements / comparedFields) * 100) : null,
    triggerEvidenceAgreementCount: mergedResults.filter(
      (result) => result.comparison?.triggerEvidenceAgreement
    ).length,
    usage: successfulUsage,
    batches,
    results: mergedResults,
    completedAt: finalBatch ? new Date().toISOString() : null
  };
}

async function persistShadowReport({
  tenantId,
  runId,
  report
}: {
  tenantId: string;
  runId: string;
  report: StoredHunterResearchLunaShadow;
}) {
  const latest = await prisma.automationJobRun.findFirst({
    where: {
      id: runId,
      tenantId,
      jobType: HUNTER_COMPANY_RESEARCH_JOB_TYPE,
      status: JobStatus.RUNNING
    },
    select: { output: true }
  });
  if (!latest) throw new Error("Hunter company-research shadow run ended before persistence.");
  const output = isRecord(latest.output) ? latest.output : {};
  const update = await prisma.automationJobRun.updateMany({
    where: {
      id: runId,
      tenantId,
      jobType: HUNTER_COMPANY_RESEARCH_JOB_TYPE,
      status: JobStatus.RUNNING
    },
    data: {
      output: {
        ...output,
        phase: report.status === "RUNNING" ? "LUNA_SHADOW_RUNNING" : "LUNA_SHADOW_COMPLETE",
        lunaShadow: report
      }
    }
  });
  if (update.count !== 1) {
    throw new Error("Hunter company-research shadow run ended before persistence.");
  }
}

function addUsage(
  left: HunterResearchShadowUsage,
  right: HunterResearchShadowUsage | null
): HunterResearchShadowUsage {
  if (!right) return left;
  return {
    inputTokens: left.inputTokens + right.inputTokens,
    cachedInputTokens: left.cachedInputTokens + right.cachedInputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    totalTokens: left.totalTokens + right.totalTokens,
    durationMs: left.durationMs + right.durationMs
  };
}

function emptyUsage(): HunterResearchShadowUsage {
  return {
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    durationMs: 0
  };
}

function safeErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim().slice(0, 500);
  }
  return "Luna shadow evaluation failed.";
}

function boundedJsonArray(value: unknown, maximumItems: number, label: string) {
  if (!Array.isArray(value) || value.length > maximumItems) {
    throw new Error(`${label} must be an array with at most ${maximumItems} items.`);
  }
  const serialized = JSON.stringify(value);
  if (serialized.length > MAX_PACKET_JSON_CHARS) throw new Error(`${label} is too large.`);
  return JSON.parse(serialized) as unknown[];
}

function stringArray(value: unknown, maximumItems: number, label: string) {
  if (!Array.isArray(value) || value.length > maximumItems) {
    throw new Error(`${label} must be a bounded array.`);
  }
  return value.map((item, index) => boundedString(item, 300, `${label}[${index}]`));
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${label} must be an object.`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function boundedString(value: unknown, maximum: number, label: string) {
  if (typeof value !== "string" || !value.trim() || value.length > maximum) {
    throw new Error(`${label} must be a non-empty bounded string.`);
  }
  return value.trim();
}

function nullableBoundedString(value: unknown, maximum: number, label: string) {
  if (value === null || value === undefined) return null;
  return boundedString(value, maximum, label);
}

function boundedInteger(value: unknown, minimum: number, maximum: number, label: string) {
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new Error(`${label} must be an integer between ${minimum} and ${maximum}.`);
  }
  return value as number;
}

function booleanValue(value: unknown, label: string) {
  if (typeof value !== "boolean") throw new Error(`${label} must be a boolean.`);
  return value;
}

function enumString<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
  label: string
): T[number] {
  if (typeof value !== "string" || !allowed.includes(value as T[number])) {
    throw new Error(`${label} is invalid.`);
  }
  return value as T[number];
}

function nonNegativeInteger(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : 0;
}

function nullableNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringOr(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function shadowStatus(value: unknown): StoredHunterResearchLunaShadow["status"] {
  return ["RUNNING", "SUCCESS", "PARTIAL", "ERROR"].includes(String(value))
    ? value as StoredHunterResearchLunaShadow["status"]
    : "ERROR";
}

function isStoredBatch(value: unknown): value is StoredShadowBatch {
  if (!isRecord(value)) return false;
  return (
    typeof value.batchId === "string" &&
    Array.isArray(value.companyIds) &&
    Array.isArray(value.qwenCompanyIds) &&
    (value.status === "SUCCESS" || value.status === "ERROR") &&
    typeof value.completedAt === "string"
  );
}

function isStoredResult(value: unknown): value is StoredShadowResult {
  if (!isRecord(value)) return false;
  return (
    typeof value.companyId === "string" &&
    typeof value.companyKey === "string" &&
    (value.qwen === null || isRecord(value.qwen)) &&
    isRecord(value.luna) &&
    (value.comparison === null || isRecord(value.comparison))
  );
}

function readStoredUsage(value: unknown): HunterResearchShadowUsage {
  if (!isRecord(value)) return emptyUsage();
  return {
    inputTokens: nonNegativeInteger(value.inputTokens),
    cachedInputTokens: nonNegativeInteger(value.cachedInputTokens),
    outputTokens: nonNegativeInteger(value.outputTokens),
    totalTokens: nonNegativeInteger(value.totalTokens),
    durationMs: nonNegativeInteger(value.durationMs)
  };
}
