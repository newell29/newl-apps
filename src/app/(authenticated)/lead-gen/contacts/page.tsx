import {
  ApolloStatus,
  ContactSource,
  ContactStatus,
  ContactOutreachDraftStatus,
  ContactTier,
  ReplyStatus,
  SequenceStatus
} from "@prisma/client";
import { PageHeader } from "@/components/page-header";
import {
  approveContactDraftAction,
  bulkUpdateContactSequenceAction,
  generateContactDraftAction,
  saveContactDraftAction,
  updateContactSequenceAction
} from "@/modules/lead-gen/actions";
import { ContactDirectoryTableClient } from "@/modules/lead-gen/components/contact-directory-table-client";
import {
  getContactDirectory,
  getContactDirectoryFilters,
  type ContactBooleanFilter,
  type ContactDraftStatusFilter,
  type ContactDirectorySort
} from "@/modules/lead-gen/queries";
import { buildSequenceCatalogItems } from "@/modules/lead-gen/sequence-catalog";
import { getCurrentTenantContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

const sortOptions = [
  { label: "Highest contact score", value: "score_desc" },
  { label: "Recently updated", value: "updated_desc" },
  { label: "Contact name A-Z", value: "name_asc" }
] as const;

type SearchParams = Record<string, string | string[] | undefined>;

export default async function ContactsPage({
  searchParams
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const tenant = await getCurrentTenantContext();
  const params = searchParams ? await searchParams : {};
  const query = readParam(params.q) ?? "";
  const companyId = readParam(params.company);
  const searchProfileId = readParam(params.searchProfile);
  const contactStatus = parseContactStatusParam(readParam(params.contactStatus));
  const apolloStatus = parseApolloStatusParam(readParam(params.apolloStatus));
  const sequenceStatus = parseSequenceStatusParam(readParam(params.sequenceStatus));
  const replyStatus = parseReplyStatusParam(readParam(params.replyStatus));
  const source = parseSourceParam(readParam(params.source));
  const contactTier = parseContactTierParam(readParam(params.tier));
  const draftStatus = parseDraftStatusParam(readParam(params.draftStatus));
  const requiresAiDraft = parseBooleanFilterParam(readParam(params.requiresAiDraft));
  const approvedDraft = parseBooleanFilterParam(readParam(params.approvedDraft));
  const hasSequenceSelected = parseBooleanFilterParam(readParam(params.hasSequenceSelected));
  const assignedRep = parseAssignedRepParam(readParam(params.rep));
  const sort = parseSortParam(readParam(params.sort));
  const hasFilters = Boolean(
      query ||
      companyId ||
      searchProfileId ||
      contactStatus !== "ALL" ||
      apolloStatus !== "ALL" ||
      sequenceStatus !== "ALL" ||
      replyStatus !== "ALL" ||
      source !== "ALL" ||
      contactTier !== "ALL" ||
      draftStatus !== "ALL" ||
      requiresAiDraft !== "ALL" ||
      approvedDraft !== "ALL" ||
      hasSequenceSelected !== "ALL" ||
      assignedRep !== "ALL" ||
      sort !== "score_desc"
  );
  const exportFilteredHref = buildContactsExportHref({
    q: query,
    company: companyId ?? "",
    searchProfile: searchProfileId ?? "",
    contactStatus,
    apolloStatus,
    sequenceStatus,
    replyStatus,
    source,
    tier: contactTier,
    draftStatus,
    requiresAiDraft,
    approvedDraft,
    hasSequenceSelected,
    rep: assignedRep,
    sort
  });
  const exportAllHref = "/api/lead-gen/contacts/export";
  const [contacts, filterOptions] = await Promise.all([
    getContactDirectory(tenant, {
      query,
      companyId,
      searchProfileId,
      contactStatus,
      apolloStatus,
      sequenceStatus,
      replyStatus,
      source,
      contactTier,
      draftStatus,
      requiresAiDraft,
      approvedDraft,
      hasSequenceSelected,
      assignedRep,
      sort
    }),
    getContactDirectoryFilters(tenant)
  ]);
  const sequenceOptions = buildSequenceCatalogItems([]);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Lead Generation"
        title="Contacts"
        description="Contacts are people attached to approved Pipeline accounts. Apollo enrichment fills this directory, and Newl Apps recommends a cadence that reps can adjust before any future sequence push."
      />

      <div className="rounded-lg border border-accentBorder bg-accentSoft px-4 py-3 text-sm text-foreground">
        This page can generate and review Newl Apps draft copy for tiers that require it, but it still does not enroll
        sequences, send email, or make outreach changes on its own.
      </div>

      <form className="rounded-lg border border-border bg-card p-4 shadow-sm" action="/lead-gen/contacts">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
          <label className="space-y-1 text-sm font-medium text-foreground xl:col-span-2">
            <span>Search contacts</span>
            <input
              name="q"
              defaultValue={query}
              placeholder="Name, company, title, or email"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
            />
          </label>

          <label className="space-y-1 text-sm font-medium text-foreground">
            <span>Company</span>
            <select
              name="company"
              defaultValue={companyId ?? ""}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
            >
              <option value="">All companies</option>
              {filterOptions.companies.map((company) => (
                <option key={company.id} value={company.id}>
                  {company.name}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-1 text-sm font-medium text-foreground">
            <span>Search profile</span>
            <select
              name="searchProfile"
              defaultValue={searchProfileId ?? ""}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
            >
              <option value="">All profiles</option>
              {filterOptions.searchProfiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.name}
                </option>
              ))}
            </select>
          </label>

          <EnumSelect
            label="Contact status"
            name="contactStatus"
            value={contactStatus}
            values={filterOptions.contactStatuses}
          />
          <EnumSelect label="Apollo status" name="apolloStatus" value={apolloStatus} values={filterOptions.apolloStatuses} />
          <EnumSelect
            label="Sequence status"
            name="sequenceStatus"
            value={sequenceStatus}
            values={filterOptions.sequenceStatuses}
          />
          <EnumSelect label="Reply status" name="replyStatus" value={replyStatus} values={filterOptions.replyStatuses} />
          <EnumSelect label="Source" name="source" value={source} values={filterOptions.sources} />
          <EnumSelect label="Tier" name="tier" value={contactTier} values={filterOptions.contactTiers} />
          <EnumSelect
            label="Draft status"
            name="draftStatus"
            value={draftStatus}
            values={filterOptions.draftStatuses}
            formatValue={formatDraftStatusFilter}
          />
          <EnumSelect
            label="Requires AI draft"
            name="requiresAiDraft"
            value={requiresAiDraft}
            values={filterOptions.booleanFilterOptions}
            formatValue={formatBooleanFilter}
          />
          <EnumSelect
            label="Approved draft"
            name="approvedDraft"
            value={approvedDraft}
            values={filterOptions.booleanFilterOptions}
            formatValue={formatBooleanFilter}
          />
          <EnumSelect
            label="Has cadence selected"
            name="hasSequenceSelected"
            value={hasSequenceSelected}
            values={filterOptions.booleanFilterOptions}
            formatValue={formatBooleanFilter}
          />

          <label className="space-y-1 text-sm font-medium text-foreground">
            <span>Assigned rep</span>
            <select
              name="rep"
              defaultValue={assignedRep}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
            >
              <option value="ALL">All reps</option>
              {filterOptions.owners.map((owner) => (
                <option key={owner} value={owner}>
                  {owner}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-1 text-sm font-medium text-foreground">
            <span>Sort</span>
            <select
              name="sort"
              defaultValue={sort}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
            >
              {sortOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <div className="flex items-end">
            <button className="w-full rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primaryForeground transition-colors hover:bg-primaryHover xl:w-auto">
              Apply filters
            </button>
          </div>
          <div className="flex items-end">
            <a
              href="/lead-gen/contacts"
              className="w-full rounded-md border border-border bg-card px-4 py-2 text-center text-sm font-semibold text-foreground transition-colors hover:bg-accentSoft xl:w-auto"
            >
              Clear filters
            </a>
          </div>
          <div className="flex items-end">
            <a
              href={exportFilteredHref}
              className="w-full rounded-md border border-border bg-card px-4 py-2 text-center text-sm font-semibold text-foreground transition-colors hover:bg-accentSoft xl:w-auto"
            >
              Export current view
            </a>
          </div>
          <div className="flex items-end">
            <a
              href={exportAllHref}
              className="w-full rounded-md border border-border bg-card px-4 py-2 text-center text-sm font-semibold text-foreground transition-colors hover:bg-accentSoft xl:w-auto"
            >
              Export all contacts
            </a>
          </div>
        </div>
      </form>

      <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-muted px-4 py-3">
          <div>
            <p className="text-sm font-semibold text-foreground">Contact cadence foundation</p>
            <p className="text-xs text-mutedForeground">
              Review selected cadences, shipment-aware draft copy, and future Apollo readiness before live sync exists.
            </p>
          </div>
          <span className="rounded-full border border-accentBorder bg-card px-2.5 py-1 text-xs font-semibold text-primary">
            {contacts.length.toLocaleString("en-US")} contacts
          </span>
        </div>

        {contacts.length > 0 ? (
          <ContactDirectoryTableClient
            contacts={contacts}
            sequenceOptions={filterOptions.sequenceOptions.length > 0 ? filterOptions.sequenceOptions : sequenceOptions}
            bulkUpdateContactSequenceAction={bulkUpdateContactSequenceAction}
            updateContactSequenceAction={updateContactSequenceAction}
            saveContactDraftAction={saveContactDraftAction}
            approveContactDraftAction={approveContactDraftAction}
            generateContactDraftAction={generateContactDraftAction}
          />
        ) : (
          <div className="px-4 py-12 text-center">
            <h2 className="text-base font-semibold text-foreground">
              {hasFilters ? "No contacts match these filters." : "No contacts yet."}
            </h2>
            <p className="mt-2 text-sm text-mutedForeground">
              {hasFilters
                ? "Adjust the company, status, source, tier, search, or sort controls to widen the contact view."
                : filterOptions.approvedAccountCount > 0
                  ? "No contacts yet for the current approved accounts. Run Apollo enrichment from Pipeline after assigning a rep."
                  : "No contacts yet. Approve companies into Pipeline first, then run Apollo enrichment to find people at those accounts."}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function EnumSelect({
  label,
  name,
  value,
  values,
  formatValue
}: {
  label: string;
  name: string;
  value: string;
  values: string[];
  formatValue?: (value: string) => string;
}) {
  return (
    <label className="space-y-1 text-sm font-medium text-foreground">
      <span>{label}</span>
      <select
        name={name}
        defaultValue={value}
        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
      >
        <option value="ALL">All</option>
        {values.map((option) => (
          <option key={option} value={option}>
            {formatValue ? formatValue(option) : formatEnum(option)}
          </option>
        ))}
      </select>
    </label>
  );
}

function parseContactStatusParam(value: string | undefined) {
  if (!value || value === "ALL") {
    return "ALL";
  }

  return Object.values(ContactStatus).includes(value as ContactStatus) ? (value as ContactStatus) : "ALL";
}

function parseApolloStatusParam(value: string | undefined) {
  if (!value || value === "ALL") {
    return "ALL";
  }

  return Object.values(ApolloStatus).includes(value as ApolloStatus) ? (value as ApolloStatus) : "ALL";
}

function parseSequenceStatusParam(value: string | undefined) {
  if (!value || value === "ALL") {
    return "ALL";
  }

  return Object.values(SequenceStatus).includes(value as SequenceStatus) ? (value as SequenceStatus) : "ALL";
}

function parseReplyStatusParam(value: string | undefined) {
  if (!value || value === "ALL") {
    return "ALL";
  }

  return Object.values(ReplyStatus).includes(value as ReplyStatus) ? (value as ReplyStatus) : "ALL";
}

function parseSourceParam(value: string | undefined) {
  if (!value || value === "ALL") {
    return "ALL";
  }

  return Object.values(ContactSource).includes(value as ContactSource) ? (value as ContactSource) : "ALL";
}

function parseContactTierParam(value: string | undefined) {
  if (!value || value === "ALL") {
    return "ALL";
  }

  return Object.values(ContactTier).includes(value as ContactTier) ? (value as ContactTier) : "ALL";
}

function parseDraftStatusParam(value: string | undefined): ContactDraftStatusFilter {
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

function parseBooleanFilterParam(value: string | undefined): ContactBooleanFilter {
  return value === "YES" || value === "NO" ? value : "ALL";
}

function parseAssignedRepParam(value: string | undefined) {
  if (!value || value === "ALL") {
    return "ALL";
  }

  return value === "UNASSIGNED" ? "UNASSIGNED" : value;
}

function parseSortParam(value: string | undefined): ContactDirectorySort {
  return sortOptions.some((option) => option.value === value) ? (value as ContactDirectorySort) : "score_desc";
}

function readParam(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}

function buildContactsExportHref(params: Record<string, string>) {
  const searchParams = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (!value || value === "ALL" || (key === "sort" && value === "score_desc")) {
      continue;
    }

    searchParams.set(key, value);
  }

  const query = searchParams.toString();
  return query.length > 0 ? `/api/lead-gen/contacts/export?${query}` : "/api/lead-gen/contacts/export";
}

function formatEnum(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function formatBooleanFilter(value: string) {
  return value === "YES" ? "Yes" : value === "NO" ? "No" : value;
}

function formatDraftStatusFilter(value: string) {
  if (value === "DRAFT_REQUIRED") {
    return "Draft required";
  }

  if (value === "NO_NEWL_DRAFT") {
    return "No Newl draft";
  }

  if (value === "APOLLO_TEMPLATE_LATER") {
    return "Apollo/template later";
  }

  return formatEnum(value);
}
