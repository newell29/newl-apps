import { AssistantSourceKind, IntegrationProvider, IntegrationStatus, ModuleKey } from "@prisma/client";

import { parseApolloRepMapping } from "@/modules/settings/apollo-rep-mapping";
import type { ApolloRepMappingEntry } from "@/modules/settings/types";
import { AuthorizationError, requireModule } from "@/server/auth/authorization";
import { prisma } from "@/server/db";
import { fetchApolloCallActivitySummary } from "@/server/integrations/apollo";
import type { AuthenticatedContext } from "@/server/tenant-context";

const DEFAULT_BUSINESS_TIMEZONE = "America/Toronto";

export type AssistantApolloActivityResponse = {
  answer: string;
  sources: Array<{
    sourceKind: AssistantSourceKind;
    sourceId: string | null;
    title: string;
    excerpt: string;
    metadata?: Record<string, unknown>;
  }>;
  metadata: Record<string, unknown>;
};

export async function maybeRunAssistantApolloActivityRequest(
  context: AuthenticatedContext,
  prompt: string
): Promise<AssistantApolloActivityResponse | null> {
  if (!isApolloActivityPrompt(prompt)) {
    return null;
  }

  try {
    await requireModule(context, ModuleKey.LEAD_GEN);
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return {
        answer: "You do not currently have access to the Lead Gen module for Apollo activity questions.",
        sources: [],
        metadata: {
          apolloActivityHandled: true,
          complete: true,
          blocked: "unauthorized"
        }
      };
    }

    throw error;
  }

  const reps = await getActiveApolloRepMappings(context.tenantId);

  if (reps.length === 0) {
    return {
      answer:
        "I can answer Apollo call and activity questions once Apollo rep mapping is synced in Settings. Sync Apollo reps, make the rep active, then ask again.",
      sources: [],
      metadata: {
        apolloActivityHandled: true,
        complete: true,
        blocked: "missing-rep-mapping"
      }
    };
  }

  const repMatch = matchApolloRep(prompt, reps);

  if (repMatch.status === "missing") {
    return {
      answer: `Which Apollo rep should I check? Active mapped reps: ${reps.map((rep) => rep.sequenceOwnerName).join(", ")}.`,
      sources: [],
      metadata: {
        apolloActivityHandled: true,
        complete: false,
        blocked: "missing-rep"
      }
    };
  }

  if (repMatch.status === "ambiguous") {
    return {
      answer: `I found more than one matching Apollo rep: ${repMatch.reps.map((rep) => rep.sequenceOwnerName).join(", ")}. Ask again with the full name.`,
      sources: [],
      metadata: {
        apolloActivityHandled: true,
        complete: false,
        blocked: "ambiguous-rep"
      }
    };
  }

  const rep = repMatch.rep;

  if (!rep.apolloUserId) {
    return {
      answer: `${rep.sequenceOwnerName} is mapped in Apollo settings but does not have an Apollo user ID saved. Sync Apollo reps again or edit the rep mapping before I can count activity.`,
      sources: [],
      metadata: {
        apolloActivityHandled: true,
        complete: true,
        blocked: "missing-apollo-user-id",
        repName: rep.sequenceOwnerName
      }
    };
  }

  const dateContext = parseActivityDate(prompt);

  try {
    const summary = await fetchApolloCallActivitySummary({
      apolloUserId: rep.apolloUserId,
      userName: rep.sequenceOwnerName,
      date: dateContext.date,
      timezone: dateContext.timezone
    });
    const durationText = formatDuration(summary.durationSeconds);
    const answer = [
      `${rep.sequenceOwnerName} made ${summary.callCount} Apollo call(s) ${dateContext.label} (${summary.dateLabel}, ${summary.timezone}).`,
      summary.connectedCount > 0 || summary.durationSeconds > 0
        ? `Connected/completed calls: ${summary.connectedCount}. Total recorded talk time: ${durationText}.`
        : "Apollo did not return connected-call or talk-time detail for the matched calls."
    ].join("\n\n");

    return {
      answer,
      sources: [
        {
          sourceKind: AssistantSourceKind.INTEGRATION,
          sourceId: `apollo:${rep.apolloUserId}:${summary.dateLabel}`,
          title: `Apollo call activity for ${rep.sequenceOwnerName}`,
          excerpt: `${summary.callCount} call(s), ${summary.connectedCount} connected/completed, ${durationText} recorded talk time.`,
          metadata: {
            provider: IntegrationProvider.APOLLO,
            apolloUserId: rep.apolloUserId,
            dateLabel: summary.dateLabel,
            timezone: summary.timezone,
            callCount: summary.callCount,
            connectedCount: summary.connectedCount,
            durationSeconds: summary.durationSeconds
          }
        }
      ],
      metadata: {
        apolloActivityHandled: true,
        complete: true,
        repName: rep.sequenceOwnerName,
        apolloUserId: rep.apolloUserId,
        dateLabel: summary.dateLabel,
        timezone: summary.timezone,
        callCount: summary.callCount,
        connectedCount: summary.connectedCount,
        durationSeconds: summary.durationSeconds
      }
    };
  } catch (error) {
    return {
      answer: [
        `I found the Apollo rep mapping for ${rep.sequenceOwnerName}, but Apollo activity lookup failed.`,
        error instanceof Error ? error.message : "Apollo returned an unknown error.",
        "Check that APOLLO_MASTER_API has activity access and that Apollo activity lookup is enabled for this workspace."
      ].join("\n\n"),
      sources: [
        {
          sourceKind: AssistantSourceKind.INTEGRATION,
          sourceId: rep.apolloUserId,
          title: `Apollo activity lookup failed for ${rep.sequenceOwnerName}`,
          excerpt: error instanceof Error ? error.message : "Unknown Apollo activity lookup error.",
          metadata: {
            provider: IntegrationProvider.APOLLO,
            apolloUserId: rep.apolloUserId
          }
        }
      ],
      metadata: {
        apolloActivityHandled: true,
        complete: true,
        apolloActivityError: error instanceof Error ? error.message : "Unknown Apollo activity lookup error.",
        repName: rep.sequenceOwnerName,
        apolloUserId: rep.apolloUserId
      }
    };
  }
}

function isApolloActivityPrompt(prompt: string) {
  return /\b(apollo|call|calls|called|dial|dials|dialed|cold call|activity|activities)\b/i.test(prompt);
}

async function getActiveApolloRepMappings(tenantId: string) {
  const credentials = await prisma.integrationCredential.findMany({
    where: {
      tenantId,
      provider: IntegrationProvider.APOLLO,
      status: {
        in: [IntegrationStatus.ACTIVE, IntegrationStatus.DISABLED]
      }
    },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    select: {
      publicConfig: true
    }
  });

  const byName = new Map<string, ApolloRepMappingEntry>();

  for (const credential of credentials) {
    for (const entry of parseApolloRepMapping(credential.publicConfig).filter((rep) => rep.active)) {
      const key = normalizeText(entry.sequenceOwnerName);
      if (!byName.has(key)) {
        byName.set(key, entry);
      }
    }
  }

  return [...byName.values()];
}

type RepMatch =
  | { status: "missing" }
  | { status: "ambiguous"; reps: ApolloRepMappingEntry[] }
  | { status: "matched"; rep: ApolloRepMappingEntry };

function matchApolloRep(prompt: string, reps: ApolloRepMappingEntry[]): RepMatch {
  const normalizedPrompt = normalizeText(prompt);
  const matches = reps.filter((rep) => {
    const name = normalizeText(rep.sequenceOwnerName);
    const nameParts = name.split(" ").filter((part) => part.length > 1);

    return normalizedPrompt.includes(name) || nameParts.some((part) => normalizedPrompt.split(" ").includes(part));
  });

  if (matches.length === 1) {
    return {
      status: "matched",
      rep: matches[0]
    };
  }

  if (matches.length > 1) {
    return {
      status: "ambiguous",
      reps: matches
    };
  }

  if (reps.length === 1 && /\b(my|the|rep|sales)\b/i.test(prompt)) {
    return {
      status: "matched",
      rep: reps[0]
    };
  }

  return {
    status: "missing"
  };
}

function parseActivityDate(prompt: string) {
  const timezone = DEFAULT_BUSINESS_TIMEZONE;
  const date = new Date();
  const lower = prompt.toLowerCase();

  if (/\byesterday\b/.test(lower)) {
    date.setDate(date.getDate() - 1);
    return {
      date,
      timezone,
      label: "yesterday"
    };
  }

  return {
    date,
    timezone,
    label: "today"
  };
}

function formatDuration(totalSeconds: number) {
  if (!totalSeconds) {
    return "0m";
  }

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.round(totalSeconds % 60);
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

function normalizeText(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
