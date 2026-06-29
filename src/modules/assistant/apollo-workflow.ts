import {
  AssistantSourceKind,
  ContactSource,
  IntegrationProvider,
  IntegrationStatus,
  ModuleKey,
  ReplyStatus,
  SequenceStatus
} from "@prisma/client";

import { parseApolloRepMapping } from "@/modules/settings/apollo-rep-mapping";
import type { ApolloRepMappingEntry } from "@/modules/settings/types";
import { AuthorizationError, requireModule } from "@/server/auth/authorization";
import { prisma } from "@/server/db";
import { fetchApolloActivitySummary, type ApolloActivityKind } from "@/server/integrations/apollo";
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
  const request = parseApolloInsightRequest(prompt);
  if (!request) {
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
  const repMatch = request.requiresRep ? matchApolloRep(prompt, reps) : matchOptionalApolloRep(prompt, reps);

  if (request.requiresRep && reps.length === 0) {
    return {
      answer:
        "I can answer rep-specific Apollo activity questions once Apollo rep mapping is synced in Settings. Sync Apollo reps, make the rep active, then ask again.",
      sources: [],
      metadata: {
        apolloActivityHandled: true,
        complete: true,
        blocked: "missing-rep-mapping"
      }
    };
  }

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

  if (rep && !rep.apolloUserId) {
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

  if (request.mode === "FOLLOW_UP_REPLIES") {
    return buildApolloReplyFollowUpAnswer(context, request, rep);
  }

  try {
    const [activitySummary, localSummary] = await Promise.all([
      request.kinds.length > 0
        ? fetchApolloActivitySummary({
            apolloUserId: rep?.apolloUserId ?? null,
            userName: rep?.sequenceOwnerName ?? null,
            startDate: request.startDate,
            endDate: request.endDate,
            timezone: request.timezone,
            kinds: request.kinds
          })
        : Promise.resolve(null),
      buildLocalApolloMetricSummary(context, request, rep)
    ]);
    const scope = rep ? rep.sequenceOwnerName : "All mapped Apollo reps";
    const dateText = formatDateRange(request);
    const lines = [`Apollo activity for ${scope} ${dateText}:`];

    if (request.metrics.includes("CALLS")) {
      lines.push(`Calls: ${activitySummary?.callCount ?? 0}.`);
    }
    if (request.metrics.includes("CONNECTED_CALLS")) {
      lines.push(`Connected calls: ${activitySummary?.connectedCount ?? 0}.`);
    }
    if (request.metrics.includes("EMAILS_SENT")) {
      lines.push(`Emails sent: ${activitySummary?.emailSentCount ?? 0}.`);
    }
    if (request.metrics.includes("REPLIES")) {
      const liveReplies = activitySummary?.replyCount ?? 0;
      lines.push(`Replies: ${Math.max(liveReplies, localSummary.replyCount)}.`);
    }
    if (request.metrics.includes("NEW_LEADS")) {
      lines.push(`New Apollo leads/contacts added in Newl: ${localSummary.newLeadCount}.`);
    }
    if (activitySummary && activitySummary.durationSeconds > 0) {
      lines.push(`Recorded call time: ${formatDuration(activitySummary.durationSeconds)}.`);
    }
    if (request.metrics.includes("NEW_LEADS") && localSummary.topNewLeads.length > 0) {
      lines.push(`Newest leads: ${localSummary.topNewLeads.map((lead) => `${lead.fullName} at ${lead.companyName}`).join("; ")}.`);
    }

    return {
      answer: lines.join("\n"),
      sources: [
        {
          sourceKind: AssistantSourceKind.INTEGRATION,
          sourceId: `apollo:${rep?.apolloUserId ?? "tenant"}:${request.startDateLabel}:${request.endDateLabel}`,
          title: `Apollo activity for ${scope}`,
          excerpt: lines.slice(1).join(" "),
          metadata: {
            provider: IntegrationProvider.APOLLO,
            apolloUserId: rep?.apolloUserId ?? null,
            repName: rep?.sequenceOwnerName ?? null,
            startDateLabel: request.startDateLabel,
            endDateLabel: request.endDateLabel,
            metrics: request.metrics,
            activityCounts: activitySummary?.counts ?? null,
            localReplyCount: localSummary.replyCount,
            localNewLeadCount: localSummary.newLeadCount
          }
        }
      ],
      metadata: {
        apolloActivityHandled: true,
        complete: true,
        repName: rep?.sequenceOwnerName ?? null,
        apolloUserId: rep?.apolloUserId ?? null,
        startDateLabel: request.startDateLabel,
        endDateLabel: request.endDateLabel,
        metrics: request.metrics
      }
    };
  } catch (error) {
    return {
      answer: [
        `I found the Apollo setup${rep ? ` for ${rep.sequenceOwnerName}` : ""}, but Apollo activity lookup failed.`,
        error instanceof Error ? error.message : "Apollo returned an unknown error.",
        "Check that APOLLO_MASTER_API has access to activity/email/reply data and that Apollo activity lookup is enabled for this workspace."
      ].join("\n\n"),
      sources: [
        {
          sourceKind: AssistantSourceKind.INTEGRATION,
          sourceId: rep?.apolloUserId ?? null,
          title: `Apollo activity lookup failed${rep ? ` for ${rep.sequenceOwnerName}` : ""}`,
          excerpt: error instanceof Error ? error.message : "Unknown Apollo activity lookup error.",
          metadata: {
            provider: IntegrationProvider.APOLLO,
            apolloUserId: rep?.apolloUserId ?? null
          }
        }
      ],
      metadata: {
        apolloActivityHandled: true,
        complete: true,
        apolloActivityError: error instanceof Error ? error.message : "Unknown Apollo activity lookup error.",
        repName: rep?.sequenceOwnerName ?? null,
        apolloUserId: rep?.apolloUserId ?? null
      }
    };
  }
}

type ApolloMetric = "CALLS" | "CONNECTED_CALLS" | "EMAILS_SENT" | "REPLIES" | "NEW_LEADS";

type ApolloInsightRequest = {
  mode: "METRICS" | "FOLLOW_UP_REPLIES";
  metrics: ApolloMetric[];
  kinds: ApolloActivityKind[];
  requiresRep: boolean;
  startDate: Date;
  endDate: Date;
  startDateLabel: string;
  endDateLabel: string;
  timezone: string;
  label: string;
};

function parseApolloInsightRequest(prompt: string): ApolloInsightRequest | null {
  if (!isApolloActivityPrompt(prompt)) {
    return null;
  }

  const lower = prompt.toLowerCase();
  const dateRange = parseActivityDateRange(prompt);

  if (/\b(summarize|summary|list|show|review|analy[sz]e|follow up|follow-up|good leads|hot leads)\b/.test(lower) && /\brepl/.test(lower)) {
    return {
      mode: "FOLLOW_UP_REPLIES",
      metrics: ["REPLIES"],
      kinds: ["REPLY"],
      requiresRep: false,
      ...dateRange
    };
  }

  const metrics = new Set<ApolloMetric>();
  const kinds = new Set<ApolloActivityKind>();

  if (/\b(connected calls?|answered calls?|completed calls?|spoke|talked)\b/.test(lower)) {
    metrics.add("CONNECTED_CALLS");
    kinds.add("CONNECTED_CALL");
  } else if (/\bcalls?|dials?|dialed|cold calls?\b/.test(lower)) {
    metrics.add("CALLS");
    kinds.add("CALL");
    kinds.add("CONNECTED_CALL");
  }

  if (/\b(emails? sent|sent emails?|outbound emails?|mail sent)\b/.test(lower)) {
    metrics.add("EMAILS_SENT");
    kinds.add("EMAIL_SENT");
  }

  if (/\b(replies|reply|responses|responded|positive replies|email replies)\b/.test(lower)) {
    metrics.add("REPLIES");
    kinds.add("REPLY");
  }

  if (/\b(new leads?|leads? added|new contacts?|contacts? added|added today)\b/.test(lower)) {
    metrics.add("NEW_LEADS");
    kinds.add("LEAD_CREATED");
  }

  if (metrics.size === 0 && /\bapollo\b/.test(lower)) {
    metrics.add("CALLS");
    metrics.add("CONNECTED_CALLS");
    metrics.add("EMAILS_SENT");
    metrics.add("REPLIES");
    metrics.add("NEW_LEADS");
    kinds.add("CALL");
    kinds.add("CONNECTED_CALL");
    kinds.add("EMAIL_SENT");
    kinds.add("REPLY");
    kinds.add("LEAD_CREATED");
  }

  if (metrics.size === 0) {
    return null;
  }

  return {
    mode: "METRICS",
    metrics: [...metrics],
    kinds: [...kinds],
    requiresRep: /\b(rep|salesperson|user)\b/i.test(prompt) && !metrics.has("NEW_LEADS"),
    ...dateRange
  };
}

async function buildApolloReplyFollowUpAnswer(
  context: AuthenticatedContext,
  request: ApolloInsightRequest,
  rep: ApolloRepMappingEntry | null
): Promise<AssistantApolloActivityResponse> {
  const contacts = await prisma.contact.findMany({
    where: {
      tenantId: context.tenantId,
      source: ContactSource.APOLLO,
      assignedRep: rep ? rep.sequenceOwnerName : undefined,
      lastReplyAt: {
        gte: request.startDate,
        lte: request.endDate
      },
      replyStatus: {
        in: [ReplyStatus.REPLIED, ReplyStatus.POSITIVE, ReplyStatus.MEETING_BOOKED]
      }
    },
    orderBy: [{ replyStatus: "desc" }, { contactScore: "desc" }, { lastReplyAt: "desc" }],
    take: 12,
    select: {
      id: true,
      fullName: true,
      title: true,
      email: true,
      contactScore: true,
      contactTier: true,
      replyStatus: true,
      sequenceStatus: true,
      lastReplyAt: true,
      selectedSequenceName: true,
      assignedRep: true,
      company: {
        select: {
          id: true,
          name: true,
          priorityScore: true,
          domain: true
        }
      }
    }
  });

  const scope = rep ? rep.sequenceOwnerName : "all Apollo reps";
  if (contacts.length === 0) {
    return {
      answer: `I found no Apollo replies for ${scope} ${formatDateRange(request)} in Newl's synced contact data.`,
      sources: [],
      metadata: {
        apolloActivityHandled: true,
        complete: true,
        replyFollowUpCount: 0
      }
    };
  }

  const strongest = [...contacts].sort((left, right) => scoreReplyLead(right) - scoreReplyLead(left)).slice(0, 6);
  const answer = [
    `Apollo replies for ${scope} ${formatDateRange(request)}: ${contacts.length} synced replied contact(s).`,
    "Best follow-up leads:",
    ...strongest.map(
      (contact, index) =>
        `${index + 1}. ${contact.company.name} - ${contact.fullName}${contact.title ? `, ${contact.title}` : ""} (${formatEnum(contact.replyStatus)}, score ${scoreReplyLead(contact)}). ${buildFollowUpReason(contact)}`
    )
  ].join("\n");

  return {
    answer,
    sources: strongest.map((contact) => ({
      sourceKind: AssistantSourceKind.CONTACT,
      sourceId: contact.id,
      title: `${contact.fullName} at ${contact.company.name}`,
      excerpt: `${formatEnum(contact.replyStatus)} reply${contact.lastReplyAt ? ` on ${contact.lastReplyAt.toISOString().slice(0, 10)}` : ""}. ${buildFollowUpReason(contact)}`,
      metadata: {
        provider: IntegrationProvider.APOLLO,
        companyId: contact.company.id,
        companyName: contact.company.name,
        replyStatus: contact.replyStatus,
        contactScore: contact.contactScore,
        companyPriorityScore: contact.company.priorityScore,
        assignedRep: contact.assignedRep
      }
    })),
    metadata: {
      apolloActivityHandled: true,
      complete: true,
      replyFollowUpCount: contacts.length,
      startDateLabel: request.startDateLabel,
      endDateLabel: request.endDateLabel
    }
  };
}

async function buildLocalApolloMetricSummary(
  context: AuthenticatedContext,
  request: ApolloInsightRequest,
  rep: ApolloRepMappingEntry | null
) {
  const [newLeadCount, replyCount, topNewLeads] = await Promise.all([
    request.metrics.includes("NEW_LEADS")
      ? prisma.contact.count({
          where: {
            tenantId: context.tenantId,
            source: ContactSource.APOLLO,
            assignedRep: rep ? rep.sequenceOwnerName : undefined,
            createdAt: {
              gte: request.startDate,
              lte: request.endDate
            }
          }
        })
      : Promise.resolve(0),
    request.metrics.includes("REPLIES")
      ? prisma.contact.count({
          where: {
            tenantId: context.tenantId,
            source: ContactSource.APOLLO,
            assignedRep: rep ? rep.sequenceOwnerName : undefined,
            lastReplyAt: {
              gte: request.startDate,
              lte: request.endDate
            },
            replyStatus: {
              not: ReplyStatus.NO_REPLY
            }
          }
        })
      : Promise.resolve(0),
    request.metrics.includes("NEW_LEADS")
      ? prisma.contact.findMany({
          where: {
            tenantId: context.tenantId,
            source: ContactSource.APOLLO,
            assignedRep: rep ? rep.sequenceOwnerName : undefined,
            createdAt: {
              gte: request.startDate,
              lte: request.endDate
            }
          },
          orderBy: {
            createdAt: "desc"
          },
          take: 5,
          select: {
            fullName: true,
            company: {
              select: {
                name: true
              }
            }
          }
        })
      : Promise.resolve([])
  ]);

  return {
    newLeadCount,
    replyCount,
    topNewLeads: topNewLeads.map((lead) => ({
      fullName: lead.fullName,
      companyName: lead.company.name
    }))
  };
}

function isApolloActivityPrompt(prompt: string) {
  return /\b(apollo|call|calls|called|dial|dials|dialed|cold call|activity|activities|replies|reply|emails? sent|new leads?|leads? added|follow up|follow-up)\b/i.test(prompt);
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

function matchOptionalApolloRep(prompt: string, reps: ApolloRepMappingEntry[]): RepMatch | { status: "matched"; rep: null } {
  const match = matchApolloRep(prompt, reps);
  return match.status === "missing" ? { status: "matched", rep: null } : match;
}

function parseActivityDateRange(prompt: string) {
  const timezone = DEFAULT_BUSINESS_TIMEZONE;
  const now = new Date();
  const lower = prompt.toLowerCase();
  const daysMatch = lower.match(/\blast\s+(\d{1,3})\s+days?\b/);
  const lastWeekdayMatch = lower.match(/\blast\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/);
  const todayLabel = formatDateLabel(now, timezone);

  if (daysMatch) {
    const days = Math.max(1, Number.parseInt(daysMatch[1], 10));
    const endDateLabel = todayLabel;
    const startDateLabel = shiftDateLabel(endDateLabel, -(days - 1));
    const startDate = zonedStartOfDay(startDateLabel, timezone);
    const endDate = zonedEndOfDay(endDateLabel, timezone);

    return {
      startDate,
      endDate,
      startDateLabel,
      endDateLabel,
      timezone,
      label: `in the last ${days} days`
    };
  }

  if (/\byesterday\b/.test(lower)) {
    const startDateLabel = shiftDateLabel(todayLabel, -1);
    const endDateLabel = startDateLabel;
    const startDate = zonedStartOfDay(startDateLabel, timezone);
    const endDate = zonedEndOfDay(endDateLabel, timezone);

    return {
      startDate,
      endDate,
      startDateLabel,
      endDateLabel,
      timezone,
      label: "yesterday"
    };
  }

  if (lastWeekdayMatch) {
    const weekdayLabel = resolveLastWeekdayLabel(todayLabel, lastWeekdayMatch[1], timezone);
    const startDate = zonedStartOfDay(weekdayLabel, timezone);
    const endDate = zonedEndOfDay(weekdayLabel, timezone);

    return {
      startDate,
      endDate,
      startDateLabel: weekdayLabel,
      endDateLabel: weekdayLabel,
      timezone,
      label: `last ${lastWeekdayMatch[1]}`
    };
  }

  const startDateLabel = todayLabel;
  const endDateLabel = todayLabel;
  const startDate = zonedStartOfDay(startDateLabel, timezone);
  const endDate = zonedEndOfDay(endDateLabel, timezone);

  return {
    startDate,
    endDate,
    startDateLabel,
    endDateLabel,
    timezone,
    label: "today"
  };
}

function formatDateRange(request: ApolloInsightRequest) {
  if (request.startDateLabel === request.endDateLabel) {
    return `${request.label} (${request.startDateLabel}, ${request.timezone})`;
  }

  return `${request.label} (${request.startDateLabel} to ${request.endDateLabel}, ${request.timezone})`;
}

function formatDateLabel(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return year && month && day ? `${year}-${month}-${day}` : date.toISOString().slice(0, 10);
}

function resolveLastWeekdayLabel(todayLabel: string, weekdayName: string, timezone: string) {
  const weekdayIndex = weekdayNameToIndex(weekdayName);
  const todayDate = zonedStartOfDay(todayLabel, timezone);
  const todayWeekday = todayDate.getUTCDay();
  let delta = (todayWeekday - weekdayIndex + 7) % 7;
  if (delta === 0) {
    delta = 7;
  }

  return shiftDateLabel(todayLabel, -delta);
}

function weekdayNameToIndex(weekdayName: string) {
  switch (weekdayName) {
    case "sunday":
      return 0;
    case "monday":
      return 1;
    case "tuesday":
      return 2;
    case "wednesday":
      return 3;
    case "thursday":
      return 4;
    case "friday":
      return 5;
    case "saturday":
      return 6;
    default:
      return 0;
  }
}

function shiftDateLabel(label: string, days: number) {
  const [year, month, day] = label.split("-").map((value) => Number.parseInt(value, 10));
  const shifted = new Date(Date.UTC(year, month - 1, day + days, 12, 0, 0, 0));
  return shifted.toISOString().slice(0, 10);
}

function zonedStartOfDay(label: string, timezone: string) {
  return zonedDateFromLabel(label, timezone, "start");
}

function zonedEndOfDay(label: string, timezone: string) {
  return new Date(zonedDateFromLabel(shiftDateLabel(label, 1), timezone, "start").getTime() - 1);
}

function zonedDateFromLabel(label: string, timezone: string, boundary: "start") {
  const [year, month, day] = label.split("-").map((value) => Number.parseInt(value, 10));
  const baseUtc = Date.UTC(year, month - 1, day, boundary === "start" ? 0 : 23, boundary === "start" ? 0 : 59, boundary === "start" ? 0 : 59, boundary === "start" ? 0 : 999);
  let instant = new Date(baseUtc - getTimeZoneOffsetMinutes(new Date(baseUtc), timezone) * 60_000);
  instant = new Date(baseUtc - getTimeZoneOffsetMinutes(instant, timezone) * 60_000);
  return instant;
}

function getTimeZoneOffsetMinutes(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    timeZoneName: "shortOffset"
  }).formatToParts(date);
  const value = parts.find((part) => part.type === "timeZoneName")?.value ?? "GMT";
  const match = value.match(/GMT([+-])(\d{1,2})(?::?(\d{2}))?/i);
  if (!match) {
    return 0;
  }

  const sign = match[1] === "-" ? -1 : 1;
  const hours = Number.parseInt(match[2], 10);
  const minutes = Number.parseInt(match[3] ?? "0", 10);
  return sign * (hours * 60 + minutes);
}

function scoreReplyLead(contact: {
  contactScore: number;
  replyStatus: ReplyStatus;
  sequenceStatus: SequenceStatus;
  company: { priorityScore: number };
}) {
  let score = contact.contactScore + contact.company.priorityScore;

  if (contact.replyStatus === ReplyStatus.MEETING_BOOKED) score += 60;
  if (contact.replyStatus === ReplyStatus.POSITIVE) score += 45;
  if (contact.replyStatus === ReplyStatus.REPLIED) score += 20;
  if (contact.sequenceStatus === SequenceStatus.REPLIED) score += 10;

  return score;
}

function buildFollowUpReason(contact: {
  contactScore: number;
  contactTier: string;
  replyStatus: ReplyStatus;
  sequenceStatus: SequenceStatus;
  selectedSequenceName: string | null;
  company: { priorityScore: number };
}) {
  const reasons = [
    contact.replyStatus === ReplyStatus.MEETING_BOOKED ? "meeting booked" : null,
    contact.replyStatus === ReplyStatus.POSITIVE ? "positive reply" : null,
    contact.replyStatus === ReplyStatus.REPLIED ? "replied" : null,
    contact.company.priorityScore >= 70 ? `high-priority company ${contact.company.priorityScore}` : null,
    contact.contactScore >= 70 ? `strong contact score ${contact.contactScore}` : null,
    contact.contactTier !== "UNRANKED" ? formatEnum(contact.contactTier) : null,
    contact.selectedSequenceName ? `sequence ${contact.selectedSequenceName}` : null
  ].filter((reason): reason is string => Boolean(reason));

  return reasons.length > 0 ? reasons.join("; ") : "Reply is synced from Apollo and should be reviewed.";
}

function formatEnum(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
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
