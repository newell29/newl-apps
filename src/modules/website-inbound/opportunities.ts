import { WebsiteInboundChannel, WebsiteInboundStatus, type Prisma } from "@prisma/client";

export const STATUS_LABELS: Record<WebsiteInboundStatus, string> = {
  NEW: "New",
  CONTACTED: "Contacted",
  QUALIFIED: "Qualified",
  QUOTE_SENT: "Quote sent",
  WON: "Won",
  NURTURE: "Nurture",
  LOST: "Lost",
  DISQUALIFIED: "Not a fit / Spam",
  REVIEWED: "Reviewed",
  CONVERTED: "Converted (legacy)",
  CLOSED: "Closed (legacy)"
};
export const CHANNEL_LABELS: Record<WebsiteInboundChannel, string> = {
  WEBSITE_FORM: "Website form",
  PHONE: "Phone",
  EMAIL: "Email",
  REFERRAL: "Referral",
  OTHER: "Other"
};
export const CLOSED_STATUSES: WebsiteInboundStatus[] = [
  "WON",
  "LOST",
  "DISQUALIFIED",
  "CONVERTED",
  "CLOSED"
];
export const VIEWS = {
  OPEN: "All open",
  NEW: "New",
  MINE: "My opportunities",
  TODAY: "Due today",
  OVERDUE: "Overdue",
  ALL: "All opportunities"
};
export const PAGE_SIZE = 25;
export const FOLLOW_UP_TIME_ZONE = "America/Toronto";

export class InboundValidationError extends Error {}

export function todayDate(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: FOLLOW_UP_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(now);
}

export function normalizePhone(phone: string | null | undefined) {
  return phone?.replace(/\D/g, "") || null;
}

function text(form: FormData, name: string, max: number) {
  const value = form.get(name);
  if (value !== null && typeof value !== "string")
    throw new InboundValidationError(`Invalid ${name}.`);
  const result = typeof value === "string" ? value.trim() : "";
  if (result.length > max)
    throw new InboundValidationError(`${name} must be ${max} characters or fewer.`);
  return result || null;
}

export function dateValue(value: string | null, label: string) {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw new InboundValidationError(`Enter a valid ${label}.`);
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new InboundValidationError(`Enter a valid ${label}.`);
  }
  return date;
}

export function parseOpportunity(form: FormData, creating = false) {
  const company = text(form, "company", 200);
  const name = text(form, "name", 200);
  const email = text(form, "email", 320);
  const phone = text(form, "phone", 64);
  // Historical forms can have partial or entirely absent contact evidence. They
  // must remain editable; only new manual opportunities require an identity.
  if (creating && !company && !name && !email && !phone) {
    throw new InboundValidationError("Enter a company, contact name, email, or phone number.");
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new InboundValidationError("Enter a valid email address.");
  const status = text(form, "status", 40);
  if (!status || !Object.hasOwn(STATUS_LABELS, status))
    throw new InboundValidationError("Select a valid status.");
  const contactChannel = text(form, "contactChannel", 40);
  if (!contactChannel || !Object.hasOwn(CHANNEL_LABELS, contactChannel))
    throw new InboundValidationError("Select a valid contact channel.");
  if (creating && contactChannel === "WEBSITE_FORM")
    throw new InboundValidationError(
      "Select how this manual enquiry arrived: phone, email, referral, or other."
    );
  const receivedOn = dateValue(text(form, "receivedOn", 10), "enquiry date");
  if (!receivedOn) throw new InboundValidationError("Enter the enquiry date.");
  const closedReason = text(form, "closedReason", 1000);
  if (status === "LOST" && !closedReason)
    throw new InboundValidationError("Add a reason for the lost opportunity.");
  return {
    company,
    name,
    email,
    phone,
    phoneNormalized: normalizePhone(phone),
    primaryNeed: text(form, "primaryNeed", 2000),
    source: text(form, "source", 200),
    status: status as WebsiteInboundStatus,
    contactChannel: contactChannel as WebsiteInboundChannel,
    ownerUserId: text(form, "ownerUserId", 100),
    receivedOn,
    nextAction: text(form, "nextAction", 1000),
    followUpOn: dateValue(text(form, "followUpOn", 10), "follow-up date"),
    closedReason
  };
}

export function parseNote(form: FormData) {
  const note = text(form, "note", 5000);
  if (!note) throw new InboundValidationError("Write a note before saving.");
  return note;
}

export type OpportunityInput = ReturnType<typeof parseOpportunity>;
export type OpportunityFilters = {
  view: keyof typeof VIEWS;
  status: WebsiteInboundStatus | "ALL";
  channel: WebsiteInboundChannel | "ALL";
  owner: string;
  formType: string;
  search: string;
  service: string;
  source: string;
  from: string;
  to: string;
  page: number;
};

export function parseFilters(
  params: Record<string, string | string[] | undefined>
): OpportunityFilters {
  const get = (key: string) =>
    (Array.isArray(params[key]) ? params[key]?.[0] : params[key])?.trim() ?? "";
  const view = get("view");
  const status = get("status");
  const channel = get("channel");
  const page = Number(get("page"));
  const validDate = (value: string) => {
    try {
      return dateValue(value, "date") ? value : "";
    } catch {
      return "";
    }
  };
  return {
    view: Object.hasOwn(VIEWS, view) ? (view as keyof typeof VIEWS) : "OPEN",
    status: Object.hasOwn(STATUS_LABELS, status) ? (status as WebsiteInboundStatus) : "ALL",
    channel: Object.hasOwn(CHANNEL_LABELS, channel) ? (channel as WebsiteInboundChannel) : "ALL",
    owner: get("owner").slice(0, 100),
    formType: get("formType").slice(0, 100),
    search: get("search").slice(0, 200),
    service: get("service").slice(0, 200),
    source: get("source").slice(0, 200),
    from: validDate(get("from")),
    to: validDate(get("to")),
    page: Number.isSafeInteger(page) && page > 0 ? Math.min(page, 100000) : 1
  };
}

export function buildOpportunityWhere(
  tenantId: string,
  userId: string,
  filters: OpportunityFilters,
  today = todayDate()
): Prisma.WebsiteInboundSubmissionWhereInput {
  const and: Prisma.WebsiteInboundSubmissionWhereInput[] = [];
  // An explicit status takes precedence over the quick-view status, allowing a
  // user to reach won/lost records directly from the default open queue.
  if (filters.status !== "ALL") and.push({ status: filters.status });
  else if (filters.view === "NEW") and.push({ status: "NEW" });
  else if (filters.view !== "ALL") and.push({ status: { notIn: CLOSED_STATUSES } });
  if (filters.view === "MINE") and.push({ ownerUserId: userId });
  if (filters.view === "TODAY") and.push({ followUpOn: new Date(`${today}T00:00:00Z`) });
  if (filters.view === "OVERDUE") and.push({ followUpOn: { lt: new Date(`${today}T00:00:00Z`) } });
  if (filters.owner)
    and.push({ ownerUserId: filters.owner === "UNASSIGNED" ? null : filters.owner });
  if (filters.formType && filters.formType !== "ALL") and.push({ formType: filters.formType });
  if (filters.channel !== "ALL") and.push({ contactChannel: filters.channel });
  if (filters.search)
    and.push({
      OR: ["name", "company", "email", "phone", "primaryNeed", "source", "nextAction"].map(
        (key) => ({ [key]: { contains: filters.search, mode: "insensitive" } })
      )
    });
  if (filters.service)
    and.push({ primaryNeed: { contains: filters.service, mode: "insensitive" } });
  if (filters.source) and.push({ source: { contains: filters.source, mode: "insensitive" } });
  if (filters.from || filters.to)
    and.push({
      receivedOn: {
        ...(filters.from ? { gte: new Date(`${filters.from}T00:00:00Z`) } : {}),
        ...(filters.to ? { lte: new Date(`${filters.to}T00:00:00Z`) } : {})
      }
    });
  return { tenantId, NOT: { formType: "account_setup" }, AND: and };
}

export function inboundUrl(filters: OpportunityFilters, extra: Record<string, string> = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...filters, ...extra })) {
    if (value !== "" && value !== "ALL") params.set(key, String(value));
  }
  // ALL is meaningful for view (and must not fall back to OPEN).
  if ((extra.view ?? filters.view) === "ALL") params.set("view", "ALL");
  return `/website-inbound?${params}`;
}

export function safeReturnUrl(value: FormDataEntryValue | null, selected: string) {
  const url =
    typeof value === "string" && value.startsWith("/website-inbound?") ? value : "/website-inbound";
  const params = new URLSearchParams(url.split("?")[1]);
  return inboundUrl(parseFilters(Object.fromEntries(params)), { selected });
}

export type OpportunityActionState = {
  status: "idle" | "success" | "error" | "duplicates";
  message?: string;
  revision?: number;
  duplicates?: { id: string; label: string }[];
};
export const EMPTY_ACTION_STATE: OpportunityActionState = { status: "idle" };
