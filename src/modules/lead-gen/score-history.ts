import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";

export const COMPANY_SCORING_MODEL_VERSION = "company-v2.0";
export const CONTACT_SCORING_MODEL_VERSION = "contact-v1.0";

export type LeadScoreType = "COMPANY_OPPORTUNITY" | "CONTACT_RELEVANCE";
export type LeadScoreTrigger =
  | "TRADEMINING_INGESTION"
  | "CANDIDATE_APPROVED"
  | "APOLLO_PUSH"
  | "APOLLO_STATUS_SYNC";

export type LeadOutcomeType =
  | "CANDIDATE_STATUS_CHANGED"
  | "PIPELINE_STAGE_CHANGED"
  | "APOLLO_SEQUENCE_ENROLLED"
  | "APOLLO_SEQUENCE_STATUS_CHANGED"
  | "APOLLO_REPLY_STATUS_CHANGED";

type ScoreHistoryPersistenceClient = {
  leadScoreSnapshot: {
    create(args: { data: Record<string, unknown> }): Promise<{ id: string }>;
    findFirst?(args: Record<string, unknown>): Promise<{ id: string } | null>;
  };
  leadOutcomeEvent: {
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
  };
};

type ScoreSnapshotHistoryRow = {
  id: string;
  companyId: string;
  contactId: string | null;
  leadId: string | null;
  scoreType: string;
  score: number;
  tier: string | null;
  modelVersion: string;
  configFingerprint: string;
  trigger: string;
  searchProfileId: string | null;
  explanation: string | null;
  evidenceAsOf: Date | null;
  createdAt: Date;
  company: { name: string };
};

type OutcomeHistoryRow = {
  id: string;
  companyId: string;
  contactId: string | null;
  leadId: string | null;
  outcomeType: string;
  previousValue: string | null;
  currentValue: string | null;
  source: string;
  actorUserId: string | null;
  scoreSnapshotId: string | null;
  scoreSnapshot: {
    score: number;
    tier: string | null;
    modelVersion: string;
    scoreType: string;
  } | null;
  occurredAt: Date;
  company: { name: string };
};

type ScoreHistoryQueryClient = {
  leadScoreSnapshot: {
    findMany(args: Record<string, unknown>): Promise<ScoreSnapshotHistoryRow[]>;
  };
  leadOutcomeEvent: {
    findMany(args: Record<string, unknown>): Promise<OutcomeHistoryRow[]>;
  };
};

export function fingerprintScoringConfig(config: unknown) {
  return createHash("sha256").update(stableSerialize(config)).digest("hex");
}

export async function recordLeadScoreSnapshot(
  input: {
    tenantId: string;
    companyId: string;
    contactId?: string | null;
    leadId?: string | null;
    scoreType: LeadScoreType;
    score: number;
    tier?: string | null;
    modelVersion: string;
    scoringConfig: unknown;
    trigger: LeadScoreTrigger;
    searchProfileId?: string | null;
    explanation?: string | null;
    breakdown: unknown;
    evidenceAsOf?: Date | null;
  },
  client: ScoreHistoryPersistenceClient = prisma as unknown as ScoreHistoryPersistenceClient
) {
  return client.leadScoreSnapshot.create({
    data: {
      tenantId: input.tenantId,
      companyId: input.companyId,
      contactId: input.contactId ?? null,
      leadId: input.leadId ?? null,
      scoreType: input.scoreType,
      score: Math.round(input.score),
      tier: input.tier ?? null,
      modelVersion: input.modelVersion,
      configFingerprint: fingerprintScoringConfig(input.scoringConfig),
      trigger: input.trigger,
      searchProfileId: input.searchProfileId ?? null,
      explanation: input.explanation ?? null,
      breakdown: toInputJsonValue(input.breakdown),
      evidenceAsOf: input.evidenceAsOf ?? null
    }
  });
}

export async function recordLeadOutcomeEvent(
  input: {
    tenantId: string;
    companyId: string;
    contactId?: string | null;
    leadId?: string | null;
    outcomeType: LeadOutcomeType;
    previousValue?: string | null;
    currentValue?: string | null;
    source: "USER_ACTION" | "TRADEMINING_INGESTION" | "APOLLO";
    actorUserId?: string | null;
    scoreSnapshotId?: string | null;
    metadata?: unknown;
    occurredAt?: Date;
  },
  client: ScoreHistoryPersistenceClient = prisma as unknown as ScoreHistoryPersistenceClient
) {
  const occurredAt = input.occurredAt ?? new Date();
  const scoreSnapshotId =
    input.scoreSnapshotId === undefined
      ? await findLatestScoreSnapshotId(
          {
            tenantId: input.tenantId,
            companyId: input.companyId,
            contactId: input.contactId ?? null,
            occurredAt
          },
          client
        )
      : input.scoreSnapshotId;

  return client.leadOutcomeEvent.create({
    data: {
      tenantId: input.tenantId,
      companyId: input.companyId,
      contactId: input.contactId ?? null,
      leadId: input.leadId ?? null,
      outcomeType: input.outcomeType,
      previousValue: input.previousValue ?? null,
      currentValue: input.currentValue ?? null,
      source: input.source,
      actorUserId: input.actorUserId ?? null,
      scoreSnapshotId: scoreSnapshotId ?? null,
      metadata: input.metadata === undefined ? undefined : toInputJsonValue(input.metadata),
      occurredAt
    }
  });
}

export async function getLeadScoringHistory(
  tenantId: string,
  limit = 100,
  client: ScoreHistoryQueryClient = prisma as unknown as ScoreHistoryQueryClient
) {
  const take = Math.min(Math.max(limit, 1), 250);
  const [snapshots, outcomes] = await Promise.all([
    client.leadScoreSnapshot.findMany({
      where: {
        tenantId
      },
      orderBy: {
        createdAt: "desc"
      },
      take,
      select: {
        id: true,
        companyId: true,
        contactId: true,
        leadId: true,
        scoreType: true,
        score: true,
        tier: true,
        modelVersion: true,
        configFingerprint: true,
        trigger: true,
        searchProfileId: true,
        explanation: true,
        evidenceAsOf: true,
        createdAt: true,
        company: {
          select: {
            name: true
          }
        }
      }
    }),
    client.leadOutcomeEvent.findMany({
      where: {
        tenantId
      },
      orderBy: {
        occurredAt: "desc"
      },
      take,
      select: {
        id: true,
        companyId: true,
        contactId: true,
        leadId: true,
        outcomeType: true,
        previousValue: true,
        currentValue: true,
        source: true,
        actorUserId: true,
        scoreSnapshotId: true,
        scoreSnapshot: {
          select: {
            score: true,
            tier: true,
            modelVersion: true,
            scoreType: true
          }
        },
        occurredAt: true,
        company: {
          select: {
            name: true
          }
        }
      }
    })
  ]);

  return {
    snapshots: snapshots.map((snapshot, index) => {
      const subjectId = snapshot.contactId ?? snapshot.leadId ?? snapshot.companyId;
      const previousSnapshot = snapshots
        .slice(index + 1)
        .find((candidate) =>
          candidate.scoreType === snapshot.scoreType &&
          (candidate.contactId ?? candidate.leadId ?? candidate.companyId) === subjectId
        );

      return {
        ...snapshot,
        scoreDelta: previousSnapshot ? snapshot.score - previousSnapshot.score : null
      };
    }),
    outcomes
  };
}

async function findLatestScoreSnapshotId(
  input: {
    tenantId: string;
    companyId: string;
    contactId: string | null;
    occurredAt: Date;
  },
  client: ScoreHistoryPersistenceClient
) {
  if (!client.leadScoreSnapshot.findFirst) {
    return null;
  }

  const snapshot = await client.leadScoreSnapshot.findFirst({
    where: {
      tenantId: input.tenantId,
      companyId: input.companyId,
      contactId: input.contactId,
      scoreType: input.contactId ? "CONTACT_RELEVANCE" : "COMPANY_OPPORTUNITY",
      createdAt: {
        lte: input.occurredAt
      }
    },
    orderBy: {
      createdAt: "desc"
    },
    select: {
      id: true
    }
  });

  return snapshot?.id ?? null;
}

function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== "object") {
    if (typeof value === "bigint") {
      return JSON.stringify(value.toString());
    }

    return JSON.stringify(value);
  }

  if (value instanceof Date) {
    return JSON.stringify(value.toISOString());
  }

  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableSerialize(entry)).join(",")}]`;
  }

  if ("toJSON" in value && typeof value.toJSON === "function") {
    return stableSerialize(value.toJSON());
  }

  return `{${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableSerialize(entry)}`)
    .join(",")}}`;
}

function toInputJsonValue(value: unknown): Prisma.InputJsonValue {
  const serialized = stableSerialize(value);

  if (serialized === undefined) {
    return {};
  }

  return JSON.parse(serialized) as Prisma.InputJsonValue;
}
