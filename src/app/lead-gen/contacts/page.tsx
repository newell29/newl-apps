import {
  ApolloStatus,
  ContactSource,
  ContactStatus,
  ContactTier,
  ReplyStatus,
  SequenceStatus
} from "@prisma/client";
import { PageHeader } from "@/components/page-header";
import {
  getContactDirectory,
  getContactDirectoryFilters,
  type ContactDirectorySort
} from "@/modules/lead-gen/queries";
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
  const contactStatus = parseContactStatusParam(readParam(params.contactStatus));
  const apolloStatus = parseApolloStatusParam(readParam(params.apolloStatus));
  const sequenceStatus = parseSequenceStatusParam(readParam(params.sequenceStatus));
  const replyStatus = parseReplyStatusParam(readParam(params.replyStatus));
  const source = parseSourceParam(readParam(params.source));
  const contactTier = parseContactTierParam(readParam(params.tier));
  const assignedRep = parseAssignedRepParam(readParam(params.rep));
  const sort = parseSortParam(readParam(params.sort));
  const hasFilters = Boolean(
    query ||
      companyId ||
      contactStatus !== "ALL" ||
      apolloStatus !== "ALL" ||
      sequenceStatus !== "ALL" ||
      replyStatus !== "ALL" ||
      source !== "ALL" ||
      contactTier !== "ALL" ||
      assignedRep !== "ALL" ||
      sort !== "score_desc"
  );
  const [contacts, filterOptions] = await Promise.all([
    getContactDirectory(tenant, {
      query,
      companyId,
      contactStatus,
      apolloStatus,
      sequenceStatus,
      replyStatus,
      source,
      contactTier,
      assignedRep,
      sort
    }),
    getContactDirectoryFilters(tenant)
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Lead Generation"
        title="Contacts"
        description="Contacts are people attached to approved Pipeline accounts. Apollo enrichment will populate this table in a future milestone."
      />

      <div className="rounded-lg border border-accentBorder bg-accentSoft px-4 py-3 text-sm text-foreground">
        Contact records sit after Pipeline approval. Newl Apps will store review state, scores, tiers, and Apollo
        snapshots here while Apollo remains the future outreach and cadence execution system.
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

          <label className="space-y-1 text-sm font-medium text-foreground">
            <span>Assigned rep</span>
            <select
              name="rep"
              defaultValue={assignedRep}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
            >
              <option value="ALL">All reps</option>
              <option value="UNASSIGNED">Unassigned</option>
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
        </div>
      </form>

      <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-muted px-4 py-3">
          <div>
            <p className="text-sm font-semibold text-foreground">Contact review foundation</p>
            <p className="text-xs text-mutedForeground">
              Person-level records for approved accounts. Apollo sync, contact approval, and sequence enrollment come later.
            </p>
          </div>
          <span className="rounded-full border border-accentBorder bg-card px-2.5 py-1 text-xs font-semibold text-primary">
            {contacts.length.toLocaleString("en-US")} contacts
          </span>
        </div>

        {contacts.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="min-w-[1440px] divide-y divide-border text-sm">
              <thead className="bg-muted text-left text-xs font-semibold uppercase text-mutedForeground">
                <tr>
                  <th className="px-4 py-3">Contact name</th>
                  <th className="px-4 py-3">Title</th>
                  <th className="px-4 py-3">Company</th>
                  <th className="px-4 py-3">Email</th>
                  <th className="px-4 py-3">Contact status</th>
                  <th className="px-4 py-3">Score / tier</th>
                  <th className="px-4 py-3">Apollo</th>
                  <th className="px-4 py-3">Sequence</th>
                  <th className="px-4 py-3">Reply</th>
                  <th className="px-4 py-3">Assigned rep</th>
                  <th className="px-4 py-3">Last touch</th>
                  <th className="px-4 py-3">Last reply</th>
                  <th className="px-4 py-3">Source</th>
                  <th className="px-4 py-3">Updated</th>
                  <th className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {contacts.map((contact) => (
                  <tr key={contact.id} className="align-top transition-colors hover:bg-muted/60">
                    <td className="max-w-[220px] px-4 py-4">
                      <p className="font-semibold text-foreground">{contact.fullName}</p>
                      <p className="mt-1 text-xs text-mutedForeground">
                        {[contact.seniority, contact.department].filter(Boolean).join(" / ") || "Unclassified"}
                      </p>
                    </td>
                    <td className="max-w-[220px] px-4 py-4 text-mutedForeground">{contact.title ?? "Unknown title"}</td>
                    <td className="max-w-[220px] px-4 py-4">
                      <p className="font-medium text-foreground">{contact.companyName}</p>
                      <p className="mt-1 text-xs text-mutedForeground">{contact.companyNormalizedName}</p>
                    </td>
                    <td className="max-w-[220px] px-4 py-4 text-mutedForeground">{contact.email ?? "No email yet"}</td>
                    <td className="px-4 py-4">
                      <StatusBadge value={contact.contactStatus} tone={contactStatusTone(contact.contactStatus)} />
                    </td>
                    <td className="px-4 py-4">
                      <span className="text-lg font-bold text-primary">{contact.contactScore}</span>
                      <p className="mt-1 text-xs font-medium text-mutedForeground">{formatEnum(contact.contactTier)}</p>
                    </td>
                    <td className="px-4 py-4">
                      <StatusBadge value={contact.apolloStatus} tone={apolloStatusTone(contact.apolloStatus)} />
                    </td>
                    <td className="px-4 py-4">
                      <StatusBadge value={contact.sequenceStatus} tone={sequenceStatusTone(contact.sequenceStatus)} />
                    </td>
                    <td className="px-4 py-4">
                      <StatusBadge value={contact.replyStatus} tone={replyStatusTone(contact.replyStatus)} />
                    </td>
                    <td className="px-4 py-4 text-mutedForeground">{contact.assignedRep}</td>
                    <td className="px-4 py-4 text-mutedForeground">{formatDate(contact.lastTouchAt)}</td>
                    <td className="px-4 py-4 text-mutedForeground">{formatDate(contact.lastReplyAt)}</td>
                    <td className="px-4 py-4 text-mutedForeground">{formatEnum(contact.source)}</td>
                    <td className="px-4 py-4 text-mutedForeground">{formatDate(contact.updatedAt)}</td>
                    <td className="px-4 py-4">
                      <div className="flex min-w-[220px] flex-wrap gap-2">
                        <button
                          disabled
                          className="rounded-md border border-border bg-muted px-3 py-1.5 text-xs font-semibold text-mutedForeground"
                        >
                          View contact
                        </button>
                        <button
                          disabled
                          className="rounded-md border border-border bg-muted px-3 py-1.5 text-xs font-semibold text-mutedForeground"
                        >
                          Approve later
                        </button>
                        <button
                          disabled
                          className="rounded-md border border-border bg-muted px-3 py-1.5 text-xs font-semibold text-mutedForeground"
                        >
                          Enroll later
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="px-4 py-12 text-center">
            <h2 className="text-base font-semibold text-foreground">
              {hasFilters ? "No contacts match these filters." : "No contacts yet."}
            </h2>
            <p className="mt-2 text-sm text-mutedForeground">
              {hasFilters
                ? "Adjust the company, status, source, tier, search, or sort controls to widen the contact view."
                : filterOptions.approvedAccountCount > 0
                  ? "Contacts will be populated by Apollo enrichment in a future milestone."
                  : "No contacts yet. Approve companies into Pipeline first, then use future Apollo enrichment to find people at those accounts."}
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
  values
}: {
  label: string;
  name: string;
  value: string;
  values: string[];
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
            {formatEnum(option)}
          </option>
        ))}
      </select>
    </label>
  );
}

function StatusBadge({ value, tone }: { value: string; tone: "neutral" | "success" | "warning" | "danger" }) {
  const className =
    tone === "success"
      ? "border-success/30 bg-success/10 text-success"
      : tone === "warning"
        ? "border-warning/30 bg-warning/10 text-warning"
        : tone === "danger"
          ? "border-danger/30 bg-danger/10 text-danger"
          : "border-accentBorder bg-accentSoft text-primary";

  return <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${className}`}>{formatEnum(value)}</span>;
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

function parseAssignedRepParam(value: string | undefined) {
  if (!value || value === "ALL") {
    return "ALL";
  }

  return value === "UNASSIGNED" ? "UNASSIGNED" : value;
}

function parseSortParam(value: string | undefined): ContactDirectorySort {
  return sortOptions.some((option) => option.value === value) ? (value as ContactDirectorySort) : "score_desc";
}

function contactStatusTone(status: ContactStatus) {
  if (status === ContactStatus.APPROVED) {
    return "success";
  }

  if (status === ContactStatus.REVIEWING) {
    return "warning";
  }

  if (status === ContactStatus.REJECTED || status === ContactStatus.DO_NOT_CONTACT) {
    return "danger";
  }

  return "neutral";
}

function apolloStatusTone(status: ApolloStatus) {
  if (status === ApolloStatus.ENRICHED) {
    return "success";
  }

  if (status === ApolloStatus.ERROR) {
    return "danger";
  }

  if (status === ApolloStatus.NOT_FOUND) {
    return "warning";
  }

  return "neutral";
}

function sequenceStatusTone(status: SequenceStatus) {
  if (status === SequenceStatus.ENROLLED || status === SequenceStatus.FINISHED || status === SequenceStatus.REPLIED) {
    return "success";
  }

  if (status === SequenceStatus.READY || status === SequenceStatus.PAUSED) {
    return "warning";
  }

  if (status === SequenceStatus.BOUNCED) {
    return "danger";
  }

  return "neutral";
}

function replyStatusTone(status: ReplyStatus) {
  if (status === ReplyStatus.POSITIVE || status === ReplyStatus.MEETING_BOOKED) {
    return "success";
  }

  if (status === ReplyStatus.NEGATIVE) {
    return "danger";
  }

  if (status === ReplyStatus.REPLIED || status === ReplyStatus.OUT_OF_OFFICE) {
    return "warning";
  }

  return "neutral";
}

function readParam(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}

function formatEnum(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function formatDate(value: Date | null) {
  if (!value) {
    return "Not recorded";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(value);
}
