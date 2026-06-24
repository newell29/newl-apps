import {
  ApolloStatus,
  ContactSource,
  ContactStatus,
  ContactOutreachDraftStatus,
  ContactTier,
  ModuleKey,
  ReplyStatus,
  SequenceStatus
} from "@prisma/client";
import { NextResponse } from "next/server";
import {
  getContactDirectory,
  type ContactBooleanFilter,
  type ContactDraftStatusFilter,
  type ContactDirectoryFilters,
  type ContactDirectorySort
} from "@/modules/lead-gen/queries";
import { requireModule } from "@/server/auth/authorization";
import { getAuthenticatedContext } from "@/server/tenant-context";

export async function GET(request: Request) {
  try {
    const context = await getAuthenticatedContext();
    await requireModule(context, ModuleKey.LEAD_GEN);

    const url = new URL(request.url);
    const filters: ContactDirectoryFilters = {
      query: readNullable(url.searchParams.get("q")) ?? undefined,
      companyId: readNullable(url.searchParams.get("company")) ?? undefined,
      searchProfileId: readNullable(url.searchParams.get("searchProfile")) ?? undefined,
      contactStatus: parseContactStatusParam(url.searchParams.get("contactStatus")),
      apolloStatus: parseApolloStatusParam(url.searchParams.get("apolloStatus")),
      sequenceStatus: parseSequenceStatusParam(url.searchParams.get("sequenceStatus")),
      replyStatus: parseReplyStatusParam(url.searchParams.get("replyStatus")),
      source: parseSourceParam(url.searchParams.get("source")),
      contactTier: parseContactTierParam(url.searchParams.get("tier")),
      draftStatus: parseDraftStatusParam(url.searchParams.get("draftStatus")),
      requiresAiDraft: parseBooleanFilterParam(url.searchParams.get("requiresAiDraft")),
      approvedDraft: parseBooleanFilterParam(url.searchParams.get("approvedDraft")),
      hasSequenceSelected: parseBooleanFilterParam(url.searchParams.get("hasSequenceSelected")),
      assignedRep: parseAssignedRepParam(url.searchParams.get("rep")),
      sort: parseSortParam(url.searchParams.get("sort"))
    };

    const contacts = await getContactDirectory(context, filters);
    const csv = toCsv([
      [
        "Contact Name",
        "Company",
        "Normalized Company",
        "Search Profile",
        "Title",
        "Department",
        "Seniority",
        "Email",
        "Source",
        "Contact Status",
        "Contact Score",
        "Contact Tier",
        "Contact Score Summary",
        "Apollo Status",
        "Sequence Status",
        "Reply Status",
        "Assigned Rep",
        "Recommended Sequence",
        "Selected Sequence",
        "Recommendation Reason",
        "Override Reason",
        "Draft Status",
        "Draft Subject",
        "Draft Body",
        "Draft Personalization Notes",
        "Last Touch",
        "Last Reply",
        "Updated At"
      ],
      ...contacts.map((contact) => [
        contact.fullName,
        contact.companyName,
        contact.companyNormalizedName,
        contact.matchedSearchProfileName ?? "",
        contact.title ?? "",
        contact.department ?? "",
        contact.seniority ?? "",
        contact.email ?? "",
        contact.source,
        contact.contactStatus,
        String(contact.contactScore),
        contact.contactTier,
        contact.contactScoreSummary,
        contact.apolloStatus,
        contact.sequenceStatus,
        contact.replyStatus,
        contact.assignedRep,
        contact.recommendedSequenceName ?? "",
        contact.selectedSequenceName ?? "",
        contact.sequenceRecommendationReason ?? "",
        contact.sequenceOverrideReason ?? "",
        contact.draftStatus,
        contact.draft?.subject ?? "",
        contact.draft?.body ?? "",
        contact.draft?.personalizationNotes ?? "",
        contact.lastTouchAt ? contact.lastTouchAt.toISOString() : "",
        contact.lastReplyAt ? contact.lastReplyAt.toISOString() : "",
        contact.updatedAt.toISOString()
      ])
    ]);

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="contacts_export.csv"'
      }
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to export contacts."
      },
      { status: 500 }
    );
  }
}

function toCsv(rows: string[][]) {
  return rows
    .map((row) => row.map((value) => `"${value.replaceAll('"', '""')}"`).join(","))
    .join("\n");
}

function readNullable(value: string | null) {
  return value && value.trim().length > 0 ? value.trim() : null;
}

function parseContactStatusParam(value: string | null) {
  if (!value || value === "ALL") {
    return "ALL";
  }

  return Object.values(ContactStatus).includes(value as ContactStatus) ? (value as ContactStatus) : "ALL";
}

function parseApolloStatusParam(value: string | null) {
  if (!value || value === "ALL") {
    return "ALL";
  }

  return Object.values(ApolloStatus).includes(value as ApolloStatus) ? (value as ApolloStatus) : "ALL";
}

function parseSequenceStatusParam(value: string | null) {
  if (!value || value === "ALL") {
    return "ALL";
  }

  return Object.values(SequenceStatus).includes(value as SequenceStatus) ? (value as SequenceStatus) : "ALL";
}

function parseReplyStatusParam(value: string | null) {
  if (!value || value === "ALL") {
    return "ALL";
  }

  return Object.values(ReplyStatus).includes(value as ReplyStatus) ? (value as ReplyStatus) : "ALL";
}

function parseSourceParam(value: string | null) {
  if (!value || value === "ALL") {
    return "ALL";
  }

  return Object.values(ContactSource).includes(value as ContactSource) ? (value as ContactSource) : "ALL";
}

function parseContactTierParam(value: string | null) {
  if (!value || value === "ALL") {
    return "ALL";
  }

  return Object.values(ContactTier).includes(value as ContactTier) ? (value as ContactTier) : "ALL";
}

function parseDraftStatusParam(value: string | null): ContactDraftStatusFilter {
  if (!value || value === "ALL") {
    return "ALL";
  }

  if (
    value === "DRAFT_REQUIRED" ||
    value === "NO_NEWL_DRAFT" ||
    value === "APOLLO_TEMPLATE_LATER" ||
    Object.values(ContactOutreachDraftStatus).includes(value as ContactOutreachDraftStatus)
  ) {
    return value as ContactDraftStatusFilter;
  }

  return "ALL";
}

function parseBooleanFilterParam(value: string | null): ContactBooleanFilter {
  return value === "YES" || value === "NO" ? value : "ALL";
}

function parseAssignedRepParam(value: string | null) {
  if (!value || value === "ALL") {
    return "ALL";
  }

  return value === "UNASSIGNED" ? "UNASSIGNED" : value;
}

function parseSortParam(value: string | null): ContactDirectorySort {
  return value === "score_desc" || value === "updated_desc" || value === "name_asc"
    ? value
    : "score_desc";
}
