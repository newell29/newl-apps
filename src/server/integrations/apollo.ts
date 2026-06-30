import { ApolloCompanyMatchClassification, ReplyStatus, SequenceStatus } from "@prisma/client";

const DEFAULT_BASE_URL = "https://api.apollo.io";
const DEFAULT_PAGE_SIZE = 100;
const APOLLO_CONTACT_PAGE_SIZE = 25;
const APOLLO_PRIMARY_ROLE_KEYWORDS = [
  "logistics",
  "supply chain",
  "operations",
  "warehouse",
  "fulfillment",
  "transportation",
  "distribution",
  "import",
  "procurement",
  "purchasing",
  "sourcing",
  "materials",
  "inventory",
  "demand planning"
] as const;
const APOLLO_FALLBACK_ROLE_KEYWORDS = [
  "ceo",
  "chief executive officer",
  "president",
  "owner",
  "founder",
  "coo",
  "chief operating officer",
  "vp operations",
  "vice president operations",
  "director operations",
  "head of operations",
  "general manager"
] as const;
const APOLLO_EXCLUDED_ROLE_KEYWORDS = [
  "accounting",
  "customer service",
  "finance",
  "human resources",
  "hr",
  "information technology",
  "legal",
  "marketing",
  "sales",
  "software"
] as const;

export type ApolloRepDirectoryEntry = {
  apolloUserId: string;
  sequenceOwnerName: string;
  email: string | null;
};

export type ApolloEmailAccountDirectoryEntry = {
  id: string;
  userId: string | null;
  email: string | null;
  active: boolean;
  isDefault: boolean;
  revokedAt: string | null;
  inactiveReason: string | null;
};

export type ApolloSequenceDirectoryEntry = {
  id: string;
  name: string;
  active: boolean;
  archived: boolean;
  description: string | null;
  lastUsedAt: string | null;
};

export type ApolloCompanyLookupInput = {
  companyName: string;
  domain?: string | null;
  apolloOrganizationId?: string | null;
};

export type ApolloContactRecord = {
  apolloContactId: string | null;
  apolloPersonId: string | null;
  firstName: string | null;
  lastName: string | null;
  fullName: string;
  title: string | null;
  department: string | null;
  seniority: string | null;
  email: string | null;
  phone: string | null;
  linkedinUrl: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  sequenceStatus: SequenceStatus;
  replyStatus: ReplyStatus;
  sequenceId: string | null;
  sequenceName: string | null;
  sequenceOwnerName: string | null;
  sequenceOwnerUserId: string | null;
  lastTouchAt: Date | null;
  lastReplyAt: Date | null;
  rawPayload: Record<string, unknown>;
};

export type ApolloContactLookupResult = {
  organizationId: string | null;
  companyName: string | null;
  domain: string | null;
  linkedinUrl: string | null;
  match: ApolloCompanyLookupMatch;
  contacts: ApolloContactRecord[];
};

export type ApolloSequencePushInput = {
  sequenceId: string;
  apolloContactIds: string[];
  sequenceOwnerUserId: string;
  sendFromEmailAccountId: string;
  initialStatus?: "active" | "paused";
};

export type ApolloSequencePushResult = {
  sequenceId: string;
  acceptedContactIds: string[];
  message: string | null;
  rawPayload: Record<string, unknown>;
};

export type ApolloActivityKind = "CALL" | "CONNECTED_CALL" | "EMAIL_SENT" | "REPLY" | "LEAD_CREATED" | "OTHER";

export type ApolloActivityRecord = {
  id: string | null;
  kind: ApolloActivityKind;
  type: string | null;
  status: string | null;
  outcome: string | null;
  durationSeconds: number | null;
  occurredAt: string | null;
  contactName: string | null;
  companyName: string | null;
  email: string | null;
  subject: string | null;
  bodyPreview: string | null;
  rawPayload: Record<string, unknown>;
};

export type ApolloActivitySummaryInput = {
  apolloUserId?: string | null;
  userName?: string | null;
  startDate: Date;
  endDate: Date;
  timezone: string;
  kinds: ApolloActivityKind[];
};

export type ApolloActivitySummary = {
  userName: string | null;
  apolloUserId: string | null;
  startDateLabel: string;
  endDateLabel: string;
  timezone: string;
  counts: Record<ApolloActivityKind, number>;
  callCount: number;
  connectedCount: number;
  emailSentCount: number;
  replyCount: number;
  leadCreatedCount: number;
  durationSeconds: number;
  activities: ApolloActivityRecord[];
  rawPayload: Record<string, unknown>;
};

export type ApolloCallActivityRecord = ApolloActivityRecord;

export type ApolloCallActivitySummaryInput = {
  apolloUserId: string;
  userName: string;
  date: Date;
  timezone: string;
};

export type ApolloCallActivitySummary = ApolloActivitySummary;

type ApolloOrganizationCandidate = {
  id: string | null;
  name: string | null;
  domain: string | null;
  linkedinUrl: string | null;
  score: number;
  nameMatchType: "EXACT" | "PARTIAL" | "TOKEN" | "NONE";
  domainMatch: boolean;
  logisticsProviderMatch: boolean;
  branchLocationMatch: boolean;
  strongBaseNameMatch: boolean;
  classification: ApolloCompanyMatchClassification;
  matchReason: string;
  query: Record<string, unknown>;
  rawPayload: Record<string, unknown>;
};

export type ApolloCompanyLookupMatch = {
  organizationId: string | null;
  companyName: string | null;
  domain: string | null;
  linkedinUrl: string | null;
  score: number;
  classification: ApolloCompanyMatchClassification;
  nameMatchType: ApolloOrganizationCandidate["nameMatchType"];
  domainMatch: boolean;
  logisticsProviderMatch: boolean;
  branchLocationMatch: boolean;
  strongBaseNameMatch: boolean;
  matchReason: string;
  query: Record<string, unknown>;
  rawPayload: Record<string, unknown> | null;
};

type ApolloUsersResponse = {
  users?: unknown;
  data?: unknown;
};

type ApolloSequencesResponse = {
  emailer_campaigns?: unknown;
  campaigns?: unknown;
  data?: unknown;
};

type ApolloEmailAccountsResponse = {
  email_accounts?: unknown;
  data?: unknown;
};

export async function fetchApolloRepDirectory(): Promise<ApolloRepDirectoryEntry[]> {
  const apiKey = readApolloMasterApiKey();
  const users: ApolloRepDirectoryEntry[] = [];
  let page = 1;

  while (true) {
    const params = new URLSearchParams({
      page: String(page),
      per_page: String(DEFAULT_PAGE_SIZE)
    });
    const response = await fetch(`${DEFAULT_BASE_URL}/api/v1/users/search?${params.toString()}`, {
      method: "GET",
      headers: buildApolloHeaders(apiKey),
      cache: "no-store"
    });
    const json = (await response.json().catch(() => null)) as ApolloUsersResponse | null;

    if (!response.ok) {
      throw new Error(extractApolloError(json) ?? `Apollo user sync failed with status ${response.status}.`);
    }

    if (!json) {
      throw new Error("Apollo user sync returned an unreadable response body.");
    }

    const pageUsers = parseApolloUsersResponse(json);
    users.push(...pageUsers);

    if (pageUsers.length < DEFAULT_PAGE_SIZE) {
      break;
    }

    page += 1;
  }

  return dedupeApolloUsers(users);
}

export async function fetchApolloSequenceDirectory(): Promise<ApolloSequenceDirectoryEntry[]> {
  const apiKey = readApolloMasterApiKey();
  const sequences: ApolloSequenceDirectoryEntry[] = [];
  let page = 1;

  while (true) {
    const params = new URLSearchParams({
      page: String(page),
      per_page: String(DEFAULT_PAGE_SIZE)
    });
    const response = await fetch(`${DEFAULT_BASE_URL}/api/v1/emailer_campaigns/search?${params.toString()}`, {
      method: "GET",
      headers: buildApolloHeaders(apiKey),
      cache: "no-store"
    });
    const json = (await response.json().catch(() => null)) as ApolloSequencesResponse | null;

    if (!response.ok) {
      throw new Error(extractApolloError(json) ?? `Apollo sequence sync failed with status ${response.status}.`);
    }

    if (!json) {
      throw new Error("Apollo sequence sync returned an unreadable response body.");
    }

    const pageSequences = parseApolloSequencesResponse(json);
    sequences.push(...pageSequences);

    if (pageSequences.length < DEFAULT_PAGE_SIZE) {
      break;
    }

    page += 1;
  }

  return dedupeApolloSequences(sequences);
}

export async function fetchApolloEmailAccountDirectory(): Promise<ApolloEmailAccountDirectoryEntry[]> {
  const apiKey = readApolloMasterApiKey();
  const response = await fetch(`${DEFAULT_BASE_URL}/api/v1/email_accounts`, {
    method: "GET",
    headers: buildApolloHeaders(apiKey),
    cache: "no-store"
  });
  const json = (await response.json().catch(() => null)) as ApolloEmailAccountsResponse | null;

  if (!response.ok) {
    throw new Error(extractApolloError(json) ?? `Apollo email account sync failed with status ${response.status}.`);
  }

  if (!json) {
    throw new Error("Apollo email account sync returned an unreadable response body.");
  }

  return parseApolloEmailAccountsResponse(json);
}

export async function fetchApolloContactsForCompany(
  input: ApolloCompanyLookupInput
): Promise<ApolloContactLookupResult> {
  const apiKey = readApolloSearchApiKey();
  const providedOrganizationId =
    input.apolloOrganizationId?.trim() && input.apolloOrganizationId !== "null"
      ? input.apolloOrganizationId.trim()
      : null;
  const matchedOrganization = await findApolloOrganization(input, apiKey);
  let effectiveMatchOrganization = matchedOrganization;
  let trustedMatchedOrganization = isDirectApolloCompanyMatch(matchedOrganization) ? matchedOrganization : null;
  const organizationIdForSearch = trustedMatchedOrganization?.id ?? providedOrganizationId ?? null;

  let contactsFromApollo =
    organizationIdForSearch || input.domain
      ? ((await searchApolloRelevantPeople({
          apiKey,
          companyName: input.companyName,
          domain: input.domain,
          organizationId: organizationIdForSearch
        })) ??
        [])
      : [];

  if (contactsFromApollo.length === 0) {
    contactsFromApollo =
      (await searchApolloRelevantPeople({
        apiKey,
        companyName: input.companyName,
        domain: input.domain,
        organizationId: null
      })) ??
      [];
  }

  if (!trustedMatchedOrganization && contactsFromApollo.length > 0) {
    const inferredOrganization = inferApolloOrganizationFromContacts(contactsFromApollo, input.companyName, normalizeDomain(input.domain));
    if (isDirectApolloCompanyMatch(inferredOrganization)) {
      trustedMatchedOrganization = inferredOrganization;
      effectiveMatchOrganization = inferredOrganization;
      contactsFromApollo = filterApolloContactsByOrganizationMatch(contactsFromApollo, input.companyName, inferredOrganization!);
    }
  }

  return {
    organizationId: trustedMatchedOrganization?.id ?? null,
    companyName: trustedMatchedOrganization?.name ?? input.companyName,
    domain: trustedMatchedOrganization?.domain ?? normalizeDomain(input.domain),
    linkedinUrl: trustedMatchedOrganization?.linkedinUrl ?? null,
    match: toApolloCompanyLookupMatch(effectiveMatchOrganization, input.companyName, normalizeDomain(input.domain)),
    contacts: dedupeApolloContacts(contactsFromApollo)
  };
}

export async function pushApolloContactsToSequence(
  input: ApolloSequencePushInput
): Promise<ApolloSequencePushResult> {
  const apiKey = readApolloMasterApiKey();
  const acceptedContactIds = [...new Set(input.apolloContactIds.map((value) => value.trim()).filter(Boolean))];

  if (acceptedContactIds.length === 0) {
    throw new Error("Apollo sequence push requires at least one Apollo contact ID.");
  }

  const sequenceId = input.sequenceId.trim();
  const sequenceOwnerUserId = input.sequenceOwnerUserId.trim();
  const sendFromEmailAccountId = input.sendFromEmailAccountId.trim();

  if (!sequenceId) {
    throw new Error("Apollo sequence push requires a sequence ID.");
  }

  if (!sequenceOwnerUserId) {
    throw new Error("Apollo sequence push requires a mapped Apollo owner user ID.");
  }

  if (!sendFromEmailAccountId) {
    throw new Error("Apollo sequence push requires a mapped Apollo send-from email account ID.");
  }

  const initialStatus = input.initialStatus ?? "active";
  const payload = {
    emailer_campaign_id: sequenceId,
    apollo_sequence_id: sequenceId,
    contact_ids: acceptedContactIds,
    sequence_owner_user_id: sequenceOwnerUserId,
    send_email_from_email_account_id: sendFromEmailAccountId,
    sequence_send_from_email_account_id: sendFromEmailAccountId,
    sequence_push_initial_status: initialStatus,
    allow_no_email: false,
    allow_unverified_email: false,
    allow_contacts_with_same_company: true,
    allow_contacts_owned_by_other_users: true
  } satisfies Record<string, unknown>;

  const rawPayload = await postApolloJson(`/api/v1/emailer_campaigns/${sequenceId}/add_contact_ids`, apiKey, payload);

  return {
    sequenceId,
    acceptedContactIds,
    message: extractApolloError(rawPayload) ?? null,
    rawPayload
  };
}

export async function fetchApolloCallActivitySummary(
  input: ApolloCallActivitySummaryInput
): Promise<ApolloActivitySummary> {
  return fetchApolloActivitySummary({
    apolloUserId: input.apolloUserId,
    userName: input.userName,
    startDate: input.date,
    endDate: input.date,
    timezone: input.timezone,
    kinds: ["CALL", "CONNECTED_CALL"]
  });
}

export async function fetchApolloActivitySummary(
  input: ApolloActivitySummaryInput
): Promise<ApolloActivitySummary> {
  const apiKey = readApolloMasterApiKey();
  const startDateLabel = formatDateInTimezone(input.startDate, input.timezone);
  const endDateLabel = formatDateInTimezone(input.endDate, input.timezone);
  const [callSummary, connectedSummary, emailSummary, activitySummary] = await Promise.all([
    input.kinds.some((kind) => kind === "CALL" || kind === "CONNECTED_CALL")
      ? fetchApolloPhoneCallSummary(apiKey, input.apolloUserId ?? null, input.startDate, input.endDate, startDateLabel, endDateLabel)
      : Promise.resolve(null),
    input.kinds.includes("CONNECTED_CALL")
      ? fetchApolloConversationSummary(apiKey, input.apolloUserId ?? null, input.startDate, input.endDate, startDateLabel, endDateLabel)
      : Promise.resolve(null),
    input.kinds.some((kind) => kind === "EMAIL_SENT" || kind === "REPLY")
      ? fetchApolloEmailMessageSummary(apiKey, input.apolloUserId ?? null, input.startDate, input.endDate, startDateLabel, endDateLabel)
      : Promise.resolve(null),
    input.kinds.includes("LEAD_CREATED") || input.kinds.includes("OTHER")
      ? fetchApolloGenericActivitySummary(apiKey, input.apolloUserId ?? null, startDateLabel, endDateLabel, input.kinds)
      : Promise.resolve(null)
  ]);

  const activities = dedupeApolloActivities([
    ...(callSummary?.activities ?? []),
    ...(connectedSummary?.activities ?? []),
    ...(emailSummary?.activities ?? []),
    ...(activitySummary?.activities ?? [])
  ]);
  const counts = countApolloActivities(activities);
  const rawPayload = {
    phoneCalls: callSummary?.rawPayload ?? null,
    conversations: connectedSummary?.rawPayload ?? null,
    emailMessages: emailSummary?.rawPayload ?? null,
    activities: activitySummary?.rawPayload ?? null
  } satisfies Record<string, unknown>;

  return {
    userName: input.userName ?? null,
    apolloUserId: input.apolloUserId ?? null,
    startDateLabel,
    endDateLabel,
    timezone: input.timezone,
    counts,
    callCount: callSummary?.callCount ?? counts.CALL + counts.CONNECTED_CALL,
    connectedCount: connectedSummary?.connectedCount ?? counts.CONNECTED_CALL,
    emailSentCount: emailSummary?.emailSentCount ?? counts.EMAIL_SENT,
    replyCount: emailSummary?.replyCount ?? counts.REPLY,
    leadCreatedCount: activitySummary?.leadCreatedCount ?? counts.LEAD_CREATED,
    durationSeconds: activities.reduce((total, activity) => total + (activity.durationSeconds ?? 0), 0),
    activities,
    rawPayload
  };
}

async function fetchApolloGenericActivitySummary(
  apiKey: string,
  apolloUserId: string | null,
  startDateLabel: string,
  endDateLabel: string,
  kinds: ApolloActivityKind[]
) {
  const path = process.env.APOLLO_ACTIVITY_SEARCH_PATH?.trim() || "/api/v1/activities/search";
  const basePayload = {
    per_page: DEFAULT_PAGE_SIZE,
    user_ids: apolloUserId ? [apolloUserId] : undefined,
    owner_ids: apolloUserId ? [apolloUserId] : undefined,
    activity_types: buildApolloActivityTypeFilters(kinds),
    types: buildApolloActivityTypeFilters(kinds),
    date_range: {
      start: startDateLabel,
      end: endDateLabel
    },
    start_date: startDateLabel,
    end_date: endDateLabel
  } satisfies Record<string, unknown>;

  const rawPayload = await fetchApolloActivityPages(path, apiKey, basePayload);
  const activities = dedupeApolloActivities(parseApolloActivities(rawPayload, apolloUserId, kinds));
  const counts = countApolloActivities(activities);
  const aggregateMetrics = extractApolloAggregateMetrics(rawPayload);

  return {
    activities,
    leadCreatedCount: aggregateMetrics.leadCreatedCount ?? counts.LEAD_CREATED,
    rawPayload
  };
}

async function fetchApolloPhoneCallSummary(
  apiKey: string,
  apolloUserId: string | null,
  startDate: Date,
  endDate: Date,
  startDateLabel: string,
  endDateLabel: string
) {
  const rawPayload = await fetchApolloPagedCollection("/api/v1/phone_calls/search", apiKey, {
    per_page: DEFAULT_PAGE_SIZE,
    user_id: apolloUserId ?? undefined,
    user_ids: apolloUserId ? [apolloUserId] : undefined,
    start_date: startDateLabel,
    end_date: endDateLabel
  });

  const entries = readApolloActivityEntries(rawPayload).map(asRecord).filter(Boolean) as Record<string, unknown>[];
  const activities = dedupeApolloActivities(
    entries
      .filter((entry) => !apolloUserId || matchesApolloUser(entry, apolloUserId))
      .map((entry) => toApolloPhoneCallActivity(entry))
      .filter((activity) => activity !== null)
      .filter((activity) => isApolloActivityWithinDateRange(activity, startDate, endDate))
  );

  return {
    callCount: activities.length,
    activities,
    rawPayload
  };
}

async function fetchApolloConversationSummary(
  apiKey: string,
  apolloUserId: string | null,
  startDate: Date,
  endDate: Date,
  startDateLabel: string,
  endDateLabel: string
) {
  const rawPayload = await fetchApolloPagedCollection("/api/v1/conversations/search", apiKey, {
    per_page: DEFAULT_PAGE_SIZE,
    user_ids: apolloUserId ? [apolloUserId] : undefined,
    start_date: startDateLabel,
    end_date: endDateLabel
  });

  const entries = readApolloActivityEntries(rawPayload).map(asRecord).filter(Boolean) as Record<string, unknown>[];
  const activities = dedupeApolloActivities(
    entries
      .filter((entry) => !apolloUserId || matchesApolloUser(entry, apolloUserId))
      .map((entry) => toApolloConversationActivity(entry))
      .filter((activity) => activity !== null)
      .filter((activity) => isApolloActivityWithinDateRange(activity, startDate, endDate))
  );

  return {
    connectedCount: activities.length,
    activities,
    rawPayload
  };
}

async function fetchApolloEmailMessageSummary(
  apiKey: string,
  apolloUserId: string | null,
  startDate: Date,
  endDate: Date,
  startDateLabel: string,
  endDateLabel: string
) {
  const rawPayload = await fetchApolloPagedCollection("/api/v1/emailer_messages/search", apiKey, {
    per_page: DEFAULT_PAGE_SIZE,
    user_ids: apolloUserId ? [apolloUserId] : undefined,
    start_date: startDateLabel,
    end_date: endDateLabel
  });

  const entries = readApolloActivityEntries(rawPayload).map(asRecord).filter(Boolean) as Record<string, unknown>[];
  const emailActivities = dedupeApolloActivities(
    entries
      .filter((entry) => !apolloUserId || matchesApolloUser(entry, apolloUserId))
      .map((entry) => toApolloEmailActivities(entry))
      .flat()
      .filter((activity) => isApolloActivityWithinDateRange(activity, startDate, endDate))
  );

  return {
    emailSentCount: emailActivities.filter((activity) => activity.kind === "EMAIL_SENT").length,
    replyCount: emailActivities.filter((activity) => activity.kind === "REPLY").length,
    activities: emailActivities,
    rawPayload
  };
}

async function fetchApolloActivityPages(path: string, apiKey: string, basePayload: Record<string, unknown>) {
  const combined: Record<string, unknown> = {};
  const buckets = new Map<string, unknown[]>();
  let previousPageSignature: string | null = null;

  for (let page = 1; page <= 10; page += 1) {
    const payload = {
      ...basePayload,
      page
    };
    const pagePayload = await postApolloJson(path, apiKey, payload);
    mergeApolloPayload(combined, buckets, pagePayload);

    const pageEntries = readApolloActivityEntries(pagePayload);
    const pageSignature = buildApolloPageSignature(pageEntries);
    if (previousPageSignature && pageSignature === previousPageSignature) {
      break;
    }
    previousPageSignature = pageSignature;

    if (pageEntries.length < DEFAULT_PAGE_SIZE) {
      break;
    }
  }

  for (const [key, value] of buckets.entries()) {
    combined[key] = value;
  }

  return combined;
}

async function fetchApolloPagedCollection(path: string, apiKey: string, basePayload: Record<string, unknown>) {
  return fetchApolloActivityPages(path, apiKey, basePayload);
}

function readApolloMasterApiKey() {
  const value = process.env.APOLLO_MASTER_API?.trim();
  if (!value || value === "APOLLO_MASTER_API_PLACEHOLDER") {
    throw new Error("Apollo master API key is not configured. Add APOLLO_MASTER_API before syncing reps.");
  }

  return value;
}

function readApolloSearchApiKey() {
  const masterKey = process.env.APOLLO_MASTER_API?.trim();
  if (masterKey && masterKey !== "APOLLO_MASTER_API_PLACEHOLDER") {
    return masterKey;
  }

  const apiKey = process.env.APOLLO_API_KEY?.trim();
  if (!apiKey || apiKey === "APOLLO_API_KEY_PLACEHOLDER") {
    throw new Error("Apollo API key is not configured. Add APOLLO_API_KEY or APOLLO_MASTER_API before importing contacts.");
  }

  return apiKey;
}

function buildApolloHeaders(apiKey: string) {
  return {
    accept: "application/json",
    "content-type": "application/json",
    "x-api-key": apiKey
  };
}

async function findApolloOrganization(input: ApolloCompanyLookupInput, apiKey: string): Promise<ApolloOrganizationCandidate | null> {
  const normalizedDomain = normalizeDomain(input.domain);
  const searchQueries = buildApolloOrganizationSearchQueries(input.companyName);
  const scoredCandidates: ApolloOrganizationCandidate[] = [];

  for (const searchCompanyName of searchQueries) {
    const body = {
      page: 1,
      per_page: 10,
      q_organization_domains: normalizedDomain ? [normalizedDomain] : undefined,
      best_company_name: searchCompanyName,
      company_match_name: searchCompanyName,
      company_identity_key: buildCompanyIdentityKey(searchCompanyName, normalizedDomain),
      original_company_name: input.companyName
    };

    const json = await postApolloJson("/api/v1/mixed_companies/search", apiKey, body);
    const candidates = parseApolloOrganizations(json);

    scoredCandidates.push(
      ...candidates.map((candidate) => scoreApolloOrganizationCandidate(candidate, input.companyName, normalizedDomain, body))
    );

    if (scoredCandidates.some((candidate) => candidate.classification === ApolloCompanyMatchClassification.DIRECT_COMPANY)) {
      break;
    }
  }

  if (scoredCandidates.length === 0) {
    return null;
  }

  return scoredCandidates.sort((left, right) => right.score - left.score)[0] ?? null;
}

async function searchApolloContacts({
  apiKey,
  companyName,
  domain,
  organizationId,
  queryKeywords
}: {
  apiKey: string;
  companyName: string;
  domain?: string | null;
  organizationId: string | null;
  queryKeywords?: string | null;
}) {
  const normalizedDomain = normalizeDomain(domain);
  const body = {
    page: 1,
    per_page: APOLLO_CONTACT_PAGE_SIZE,
    organization_ids: organizationId ? [organizationId] : undefined,
    q_organization_domains: normalizedDomain ? [normalizedDomain] : undefined,
    q_keywords: buildApolloPeopleSearchKeywords(companyName, queryKeywords, Boolean(organizationId || normalizedDomain))
  };

  const json = await postApolloJson("/api/v1/contacts/search", apiKey, body);
  const contacts = parseApolloContacts(json);
  return contacts.length > 0 ? contacts : null;
}

async function searchApolloPeople({
  apiKey,
  companyName,
  domain,
  organizationId,
  queryKeywords
}: {
  apiKey: string;
  companyName: string;
  domain?: string | null;
  organizationId: string | null;
  queryKeywords?: string | null;
}) {
  const normalizedDomain = normalizeDomain(domain);
  const body = {
    page: 1,
    per_page: APOLLO_CONTACT_PAGE_SIZE,
    organization_ids: organizationId ? [organizationId] : undefined,
    q_organization_domains: normalizedDomain ? [normalizedDomain] : undefined,
    q_keywords: buildApolloPeopleSearchKeywords(companyName, queryKeywords, Boolean(organizationId || normalizedDomain))
  };

  const json = await postApolloJson("/api/v1/mixed_people/api_search", apiKey, body);
  return parseApolloContacts(json);
}

async function searchApolloRelevantPeople({
  apiKey,
  companyName,
  domain,
  organizationId
}: {
  apiKey: string;
  companyName: string;
  domain?: string | null;
  organizationId: string | null;
}) {
  const collected: ApolloContactRecord[] = [];

  const contactsWithoutKeyword =
    (await searchApolloContacts({
      apiKey,
      companyName,
      domain,
      organizationId,
      queryKeywords: null
    })) ?? [];
  collected.push(...contactsWithoutKeyword);

  const relevantContactsWithoutKeyword = rankApolloRelevantContacts(collected);
  if (relevantContactsWithoutKeyword.length > 0) {
    return relevantContactsWithoutKeyword;
  }

  const peopleWithoutKeyword = await searchApolloPeople({
    apiKey,
    companyName,
    domain,
    organizationId,
    queryKeywords: null
  });
  collected.push(...peopleWithoutKeyword);

  const relevantPeopleWithoutKeyword = rankApolloRelevantContacts(collected);
  if (relevantPeopleWithoutKeyword.length > 0) {
    return relevantPeopleWithoutKeyword;
  }

  for (const keyword of [...APOLLO_PRIMARY_ROLE_KEYWORDS, ...APOLLO_FALLBACK_ROLE_KEYWORDS]) {
    const people = await searchApolloPeople({
      apiKey,
      companyName,
      domain,
      organizationId,
      queryKeywords: keyword
    });
    collected.push(...people);
  }

  const ranked = rankApolloRelevantContacts(collected);
  return ranked.length > 0 ? ranked : dedupeApolloContacts(collected);
}

async function postApolloJson(path: string, apiKey: string, body: Record<string, unknown>) {
  const response = await fetch(`${DEFAULT_BASE_URL}${path}`, {
    method: "POST",
    headers: buildApolloHeaders(apiKey),
    cache: "no-store",
    body: JSON.stringify(body)
  });
  const json = (await response.json().catch(() => null)) as Record<string, unknown> | null;

  if (!response.ok) {
    throw new Error(extractApolloError(json) ?? `Apollo request failed with status ${response.status}.`);
  }

  if (!json) {
    throw new Error("Apollo returned an unreadable response body.");
  }

  return json;
}

function parseApolloUsersResponse(payload: ApolloUsersResponse | null): ApolloRepDirectoryEntry[] {
  const candidate = Array.isArray(payload?.users)
    ? payload?.users
    : Array.isArray(payload?.data)
      ? payload?.data
      : [];

  return candidate.flatMap((entry) => {
    if (!entry || typeof entry !== "object") {
      return [];
    }

    const record = entry as Record<string, unknown>;
    if (record.deleted === true) {
      return [];
    }

    const apolloUserId = readApolloString(record, ["id", "user_id"]);
    const sequenceOwnerName =
      readApolloString(record, ["name", "full_name"]) ??
      buildName(readApolloString(record, ["first_name"]), readApolloString(record, ["last_name"]));

    if (!apolloUserId || !sequenceOwnerName) {
      return [];
    }

    return [
      {
        apolloUserId,
        sequenceOwnerName,
        email: readApolloString(record, ["email"])
      }
    ];
  });
}

function parseApolloSequencesResponse(payload: ApolloSequencesResponse | null): ApolloSequenceDirectoryEntry[] {
  const candidates = Array.isArray(payload?.emailer_campaigns)
    ? payload?.emailer_campaigns
    : Array.isArray(payload?.campaigns)
      ? payload?.campaigns
      : Array.isArray(payload?.data)
        ? payload?.data
        : [];

  return candidates.flatMap((entry) => {
    const record = asRecord(entry);
    if (!record) {
      return [];
    }

    const id = readApolloString(record, ["id", "emailer_campaign_id"]);
    const name = readApolloString(record, ["name"]);
    if (!id || !name) {
      return [];
    }

    return [
      {
        id,
        name,
        active: readApolloBoolean(record, ["active"], true),
        archived: readApolloBoolean(record, ["archived"], false),
        description: readApolloString(record, ["description"]),
        lastUsedAt: readApolloString(record, ["last_used_at", "updated_at", "created_at"])
      }
    ];
  });
}

function parseApolloEmailAccountsResponse(payload: ApolloEmailAccountsResponse | null): ApolloEmailAccountDirectoryEntry[] {
  const candidates = Array.isArray(payload?.email_accounts)
    ? payload?.email_accounts
    : Array.isArray(payload?.data)
      ? payload?.data
      : [];

  return candidates.flatMap((entry) => {
    const record = asRecord(entry);
    if (!record) {
      return [];
    }

    const id = readApolloString(record, ["id", "email_account_id"]);
    if (!id) {
      return [];
    }

    return [
      {
        id,
        userId: readApolloString(record, ["user_id", "owner_user_id"]),
        email: readApolloString(record, ["email", "address"]),
        active: readApolloBoolean(record, ["active"], false),
        isDefault: readApolloBoolean(record, ["default"], false),
        revokedAt: readApolloString(record, ["revoked_at"]),
        inactiveReason: readApolloString(record, ["inactive_reason"])
      }
    ];
  });
}

function parseApolloActivities(
  payload: Record<string, unknown>,
  apolloUserId: string | null,
  requestedKinds: ApolloActivityKind[]
): ApolloActivityRecord[] {
  const candidates = readApolloActivityEntries(payload);

  return candidates.flatMap((entry) => {
    const record = asRecord(entry);
    if (!record || (apolloUserId && !matchesApolloUser(record, apolloUserId))) {
      return [];
    }
    const kind = classifyApolloActivity(record);
    if (!requestedKinds.includes(kind) && !(kind === "CONNECTED_CALL" && requestedKinds.includes("CALL"))) {
      return [];
    }

    return [
      {
        id: readApolloString(record, ["id", "activity_id", "call_id"]),
        kind,
        type: readApolloString(record, ["type", "activity_type", "kind", "category"]),
        status: readApolloString(record, ["status", "call_status"]),
        outcome: readApolloString(record, ["outcome", "disposition", "call_disposition"]),
        durationSeconds: readApolloNumber(record, ["duration_seconds", "call_duration_seconds", "duration"]),
        occurredAt: readApolloString(record, ["occurred_at", "created_at", "completed_at", "updated_at"]),
        contactName: readApolloString(record, ["contact_name", "person_name", "name", "recipient_name"]),
        companyName: readApolloString(record, ["company_name", "organization_name", "account_name"]),
        email: readApolloString(record, ["email", "recipient_email", "from_email"]),
        subject: readApolloString(record, ["subject", "email_subject"]),
        bodyPreview: readApolloString(record, ["body_preview", "preview", "snippet", "body_text"]),
        rawPayload: record
      }
    ];
  });
}

function parseApolloOrganizations(payload: Record<string, unknown>) {
  const candidates = [
    ...readApolloArray(payload, ["accounts"]),
    ...readApolloArray(payload, ["organizations"]),
    ...readApolloArray(payload, ["companies"]),
    ...readApolloArray(payload, ["data"])
  ];

  const deduped = new Map<
    string,
    { id: string | null; name: string | null; domain: string | null; linkedinUrl: string | null; rawPayload: Record<string, unknown> }
  >();

  for (const candidate of candidates) {
    const record = asRecord(candidate);
    if (!record) {
      continue;
    }

    const id = readApolloString(record, ["id", "organization_id", "apollo_organization_id"]);
    const name = readApolloString(record, ["name", "company_name", "organization_name"]);
    const domain = normalizeDomain(
      readApolloString(record, ["primary_domain", "website_url", "domain", "apollo_domain"])
    );
    const linkedinUrl = readApolloString(record, [
      "linkedin_url",
      "organization_linkedin_url",
      "company_linkedin_url",
      "linkedin",
      "linkedin_profile_url"
    ]);

    if (!id && !name && !domain && !linkedinUrl) {
      continue;
    }

    const key = [id, name?.toLowerCase() ?? "", domain ?? "", linkedinUrl ?? ""].join("|");
    if (!deduped.has(key)) {
      deduped.set(key, { id, name, domain, linkedinUrl, rawPayload: record });
    }
  }

  return [...deduped.values()];
}

function parseApolloContacts(payload: Record<string, unknown>): ApolloContactRecord[] {
  const candidates = [
    ...readApolloArray(payload, ["contacts"]),
    ...readApolloArray(payload, ["people"]),
    ...readApolloArray(payload, ["persons"]),
    ...readApolloArray(payload, ["data"])
  ];

  return candidates.flatMap((candidate) => {
    const record = asRecord(candidate);
    if (!record) {
      return [];
    }

    const firstName = readApolloString(record, ["first_name"]);
    const lastName = readApolloString(record, ["last_name"]);
    const fullName =
      readApolloString(record, ["full_name", "name"]) ??
      buildName(firstName, lastName);

    if (!fullName) {
      return [];
    }

    const organization = asRecord(record.organization) ?? asRecord(record.account) ?? asRecord(record.company);
    const sequenceDetails = asRecord(record.sequence) ?? asRecord(record.cadence) ?? asRecord(record.enrollment);

    return [
      {
        apolloContactId: readApolloString(record, ["contact_id", "apollo_contact_id", "id"]),
        apolloPersonId: readApolloString(record, ["person_id", "apollo_person_id"]),
        firstName,
        lastName,
        fullName,
        title: readApolloString(record, ["title", "job_title"]),
        department: readApolloString(record, ["department", "department_name", "function"]),
        seniority: readApolloString(record, ["seniority", "seniority_level"]),
        email: readApolloString(record, ["email"]),
        phone: readApolloString(record, ["phone", "phone_number", "mobile_phone"]),
        linkedinUrl: readApolloString(record, ["linkedin_url"]),
        city: readApolloString(record, ["city"]),
        state: readApolloString(record, ["state", "region"]),
        country: readApolloString(record, ["country"]),
        sequenceStatus: parseSequenceStatus(
          readApolloString(record, [
            "apollo_sequence_status",
            "sequence_status",
            "enrollment_status",
            "emailer_campaign_status"
          ]) ??
            readApolloString(sequenceDetails ?? {}, ["status", "state"])
        ),
        replyStatus: parseReplyStatus(
          readApolloString(record, ["reply_status", "response_status", "last_response_type"])
        ),
        sequenceId:
          readApolloString(record, ["apollo_sequence_id", "sequence_id", "emailer_campaign_id"]) ??
          readApolloString(sequenceDetails ?? {}, ["id"]),
        sequenceName:
          readApolloString(record, ["apollo_sequence_name", "sequence_name", "cadence_recommendation"]) ??
          readApolloString(sequenceDetails ?? {}, ["name"]),
        sequenceOwnerName:
          readApolloString(record, ["sequence_owner_name", "owner_name"]) ??
          readApolloString(sequenceDetails ?? {}, ["owner_name"]),
        sequenceOwnerUserId:
          readApolloString(record, ["sequence_owner_user_id", "owner_user_id"]) ??
          readApolloString(sequenceDetails ?? {}, ["owner_id"]),
        lastTouchAt: parseApolloDate(
          readApolloString(record, ["updated_at", "last_activity_at", "last_contacted_at", "last_touch_at"])
        ),
        lastReplyAt: parseApolloDate(
          readApolloString(record, ["last_reply_at", "replied_at", "responded_at", "apollo_sequence_enrolled_at"])
        ),
        rawPayload: {
          ...record,
          organization,
          sequence: sequenceDetails
        }
      }
    ];
  });
}

function inferApolloOrganizationFromContacts(
  contacts: ApolloContactRecord[],
  companyName: string,
  normalizedDomain: string | null
) {
  const inputAliases = buildCompanyNameAliases(companyName);
  const candidates = new Map<
    string,
    {
      id: string | null;
      name: string | null;
      domain: string | null;
      linkedinUrl: string | null;
      rawPayload: Record<string, unknown>;
      appearances: number;
    }
  >();

  for (const contact of contacts) {
    const organization = readApolloOrganizationFromContact(contact);
    if (!organization?.name && !organization?.id && !organization?.domain) {
      continue;
    }

    const key = [organization.id ?? "", organization.name?.toLowerCase() ?? "", organization.domain ?? ""].join("|");
    const existing = candidates.get(key);
    if (existing) {
      existing.appearances += 1;
      continue;
    }

    candidates.set(key, {
      ...organization,
      appearances: 1
    });
  }

  const scored = [...candidates.values()].map((candidate) => {
    const base = scoreApolloOrganizationCandidate(candidate, companyName, normalizedDomain, {
      source: "people-search-fallback"
    });
    return {
      ...base,
      score: base.score + Math.min(candidate.appearances * 2, 8),
      matchReason: `${base.matchReason}; people evidence x${candidate.appearances}`
    };
  });

  const best = scored.sort((left, right) => right.score - left.score)[0] ?? null;
  if (!best) {
    return null;
  }

  const bestAliases = buildCompanyNameAliases(best.name ?? "");
  const exactPeopleBackedNameMatch = hasExactAliasMatch(inputAliases, bestAliases);
  const strongPeopleBackedNameMatch = hasStrongBaseNameMatch(inputAliases, bestAliases);
  const peopleEvidenceCount = candidates.get(
    [best.id ?? "", best.name?.toLowerCase() ?? "", best.domain ?? ""].join("|")
  )?.appearances ?? 0;

  const promotedClassification =
    (exactPeopleBackedNameMatch || strongPeopleBackedNameMatch) && peopleEvidenceCount >= 1
      ? ApolloCompanyMatchClassification.DIRECT_COMPANY
      : classifyApolloOrganizationCandidate({
          id: best.id,
          score: best.score,
          nameMatchType: best.nameMatchType,
          domainMatch: best.domainMatch,
          logisticsProviderMatch: best.logisticsProviderMatch,
          branchLocationMatch: best.branchLocationMatch,
          strongBaseNameMatch: best.strongBaseNameMatch,
          tokenSimilarity: calculateBestTokenSimilarity(inputAliases, bestAliases)
        });

  return {
    ...best,
    classification: promotedClassification,
    matchReason:
      promotedClassification === ApolloCompanyMatchClassification.DIRECT_COMPANY &&
      (exactPeopleBackedNameMatch || strongPeopleBackedNameMatch)
        ? `${best.matchReason}; promoted from matching people-search organization evidence`
        : best.matchReason
  };
}

function readApolloOrganizationFromContact(contact: ApolloContactRecord) {
  const raw = asRecord(contact.rawPayload);
  const organization = asRecord(raw?.organization) ?? asRecord(raw?.account) ?? asRecord(raw?.company);
  if (!organization) {
    return null;
  }

  return {
    id: readApolloString(organization, ["id", "organization_id", "apollo_organization_id"]),
    name: readApolloString(organization, ["name", "company_name", "organization_name"]),
    domain: normalizeDomain(readApolloString(organization, ["primary_domain", "website_url", "domain"])),
    linkedinUrl: readApolloString(organization, [
      "linkedin_url",
      "organization_linkedin_url",
      "company_linkedin_url",
      "linkedin_profile_url"
    ]),
    rawPayload: organization
  };
}

function filterApolloContactsByOrganizationMatch(
  contacts: ApolloContactRecord[],
  companyName: string,
  organization: ApolloOrganizationCandidate
) {
  const inputAliases = buildCompanyNameAliases(companyName);
  const organizationAliases = buildCompanyNameAliases(organization.name ?? "");

  return contacts.filter((contact) => {
    const candidateOrganization = readApolloOrganizationFromContact(contact);
    if (!candidateOrganization?.name) {
      return false;
    }

    const contactAliases = buildCompanyNameAliases(candidateOrganization.name);
    return (
      hasExactAliasMatch(inputAliases, contactAliases) ||
      hasStrongBaseNameMatch(inputAliases, contactAliases) ||
      hasExactAliasMatch(organizationAliases, contactAliases) ||
      calculateBestTokenSimilarity(organizationAliases, contactAliases) >= 0.85
    );
  });
}

function dedupeApolloUsers(entries: ApolloRepDirectoryEntry[]) {
  const deduped = new Map<string, ApolloRepDirectoryEntry>();

  for (const entry of entries) {
    if (!deduped.has(entry.apolloUserId)) {
      deduped.set(entry.apolloUserId, entry);
    }
  }

  return [...deduped.values()].sort((left, right) => left.sequenceOwnerName.localeCompare(right.sequenceOwnerName));
}

function dedupeApolloContacts(entries: ApolloContactRecord[]) {
  const deduped = new Map<string, ApolloContactRecord>();

  for (const entry of entries) {
    const key =
      entry.apolloContactId ??
      entry.apolloPersonId ??
      entry.email?.toLowerCase() ??
      `${entry.fullName.toLowerCase()}|${entry.title?.toLowerCase() ?? ""}`;

    const existing = deduped.get(key);
    if (!existing || scoreApolloContactEntry(entry) > scoreApolloContactEntry(existing)) {
      deduped.set(key, entry);
    }
  }

  return [...deduped.values()];
}

function dedupeApolloSequences(entries: ApolloSequenceDirectoryEntry[]) {
  const deduped = new Map<string, ApolloSequenceDirectoryEntry>();

  for (const entry of entries) {
    if (!deduped.has(entry.id)) {
      deduped.set(entry.id, entry);
    }
  }

  return [...deduped.values()].sort((left, right) => {
    if (left.active !== right.active) {
      return left.active ? -1 : 1;
    }

    return left.name.localeCompare(right.name);
  });
}

function scoreApolloOrganizationCandidate(
  candidate: {
    id: string | null;
    name: string | null;
    domain: string | null;
    linkedinUrl: string | null;
    rawPayload: Record<string, unknown>;
  },
  companyName: string,
  normalizedDomain: string | null,
  query: Record<string, unknown>
): ApolloOrganizationCandidate {
  let score = 0;
  let nameMatchType: ApolloOrganizationCandidate["nameMatchType"] = "NONE";
  const inputAliases = buildCompanyNameAliases(companyName);
  const candidateAliases = buildCompanyNameAliases(candidate.name ?? "");
  const tokenSimilarity = calculateBestTokenSimilarity(inputAliases, candidateAliases);
  const logisticsProviderMatch = isLogisticsProviderName(candidate.name ?? "") || isLogisticsProviderName(companyName);
  const strongBaseNameMatch = hasStrongBaseNameMatch(inputAliases, candidateAliases);
  const branchLocationMatch = isBranchLocationMatch(candidate.name ?? "", companyName) && !strongBaseNameMatch;

  if (candidate.id) {
    score += 4;
  }

  const domainMatch = Boolean(normalizedDomain && candidate.domain === normalizedDomain);
  if (domainMatch) {
    score += 10;
  }

  if (candidate.name) {
    if (hasExactAliasMatch(inputAliases, candidateAliases)) {
      nameMatchType = "EXACT";
      score += 8;
    } else if (hasPartialAliasMatch(inputAliases, candidateAliases)) {
      nameMatchType = "PARTIAL";
      score += 4;
    } else if (tokenSimilarity >= 0.75) {
      nameMatchType = "TOKEN";
      score += 3;
    }
  }

  if (tokenSimilarity >= 0.85) {
    score += 3;
  } else if (tokenSimilarity >= 0.65) {
    score += 1;
  }

  if (strongBaseNameMatch) {
    score += 4;
  }

  if (logisticsProviderMatch) {
    score -= 8;
  }

  if (branchLocationMatch) {
    score -= 4;
  }

  const classification = classifyApolloOrganizationCandidate({
    id: candidate.id,
    score,
    nameMatchType,
    domainMatch,
    logisticsProviderMatch,
    branchLocationMatch,
    strongBaseNameMatch,
    tokenSimilarity
  });

  return {
    ...candidate,
    score,
    nameMatchType,
    domainMatch,
    logisticsProviderMatch,
    branchLocationMatch,
    strongBaseNameMatch,
    classification,
    matchReason: buildApolloMatchReason({
      classification,
      score,
      nameMatchType,
      domainMatch,
      logisticsProviderMatch,
      branchLocationMatch,
      strongBaseNameMatch,
      tokenSimilarity
    }),
    query
  };
}

function isDirectApolloCompanyMatch(candidate: ApolloOrganizationCandidate | null) {
  if (!candidate?.id) {
    return false;
  }

  return candidate.classification === ApolloCompanyMatchClassification.DIRECT_COMPANY;
}

function toApolloCompanyLookupMatch(
  candidate: ApolloOrganizationCandidate | null,
  companyName: string,
  normalizedDomain: string | null
): ApolloCompanyLookupMatch {
  if (!candidate) {
    return {
      organizationId: null,
      companyName,
      domain: normalizedDomain,
      linkedinUrl: null,
      score: 0,
      classification: ApolloCompanyMatchClassification.NO_MATCH,
      nameMatchType: "NONE",
      domainMatch: false,
      logisticsProviderMatch: false,
      branchLocationMatch: false,
      strongBaseNameMatch: false,
      matchReason: "No Apollo organization candidates were returned for this company.",
      query: {
        companyName,
        domain: normalizedDomain
      },
      rawPayload: null
    };
  }

  return {
    organizationId: candidate.id,
    companyName: candidate.name,
    domain: candidate.domain,
    linkedinUrl: candidate.linkedinUrl,
    score: candidate.score,
    classification: candidate.classification,
    nameMatchType: candidate.nameMatchType,
    domainMatch: candidate.domainMatch,
    logisticsProviderMatch: candidate.logisticsProviderMatch,
    branchLocationMatch: candidate.branchLocationMatch,
    strongBaseNameMatch: candidate.strongBaseNameMatch,
    matchReason: candidate.matchReason,
    query: candidate.query,
    rawPayload: candidate.rawPayload
  };
}

function classifyApolloOrganizationCandidate({
  id,
  score,
  nameMatchType,
  domainMatch,
  logisticsProviderMatch,
  branchLocationMatch,
  strongBaseNameMatch,
  tokenSimilarity
}: {
  id: string | null;
  score: number;
  nameMatchType: ApolloOrganizationCandidate["nameMatchType"];
  domainMatch: boolean;
  logisticsProviderMatch: boolean;
  branchLocationMatch: boolean;
  strongBaseNameMatch: boolean;
  tokenSimilarity: number;
}) {
  if (!id) {
    return ApolloCompanyMatchClassification.NO_MATCH;
  }

  if (logisticsProviderMatch) {
    return ApolloCompanyMatchClassification.LOGISTICS_PROVIDER;
  }

  if (branchLocationMatch) {
    return ApolloCompanyMatchClassification.MATCH_QUALITY_REVIEW;
  }

  if (domainMatch && (nameMatchType === "EXACT" || nameMatchType === "PARTIAL" || tokenSimilarity >= 0.65)) {
    return ApolloCompanyMatchClassification.DIRECT_COMPANY;
  }

  if (nameMatchType === "EXACT" && score >= 10) {
    return ApolloCompanyMatchClassification.DIRECT_COMPANY;
  }

  if ((nameMatchType === "PARTIAL" || nameMatchType === "TOKEN") && score >= 10 && tokenSimilarity >= 0.75) {
    return ApolloCompanyMatchClassification.DIRECT_COMPANY;
  }

  if (strongBaseNameMatch && score >= 8) {
    return ApolloCompanyMatchClassification.DIRECT_COMPANY;
  }

  return score > 0 ? ApolloCompanyMatchClassification.MATCH_QUALITY_REVIEW : ApolloCompanyMatchClassification.NO_MATCH;
}

function buildApolloMatchReason({
  classification,
  score,
  nameMatchType,
  domainMatch,
  logisticsProviderMatch,
  branchLocationMatch,
  strongBaseNameMatch,
  tokenSimilarity
}: {
  classification: ApolloCompanyMatchClassification;
  score: number;
  nameMatchType: ApolloOrganizationCandidate["nameMatchType"];
  domainMatch: boolean;
  logisticsProviderMatch: boolean;
  branchLocationMatch: boolean;
  strongBaseNameMatch: boolean;
  tokenSimilarity: number;
}) {
  const parts = [`${classification.toLowerCase().replaceAll("_", " ")}; score ${score}`];

  if (domainMatch) {
    parts.push("domain matched");
  }

  if (nameMatchType !== "NONE") {
    parts.push(`${nameMatchType.toLowerCase()} name match`);
  }

  if (tokenSimilarity > 0) {
    parts.push(`token similarity ${Math.round(tokenSimilarity * 100)}%`);
  }

  if (logisticsProviderMatch) {
    parts.push("logistics/provider wording detected");
  }

  if (branchLocationMatch) {
    parts.push("branch or location wording detected");
  }

  if (strongBaseNameMatch) {
    parts.push("strong base-name match");
  }

  return parts.join("; ");
}

function scoreApolloContactEntry(entry: ApolloContactRecord) {
  let score = 0;
  const roleFit = scoreApolloRoleFit(entry);
  score += roleFit.score;
  if (entry.email) score += 4;
  if (entry.title) score += 2;
  if (entry.linkedinUrl) score += 2;
  if (entry.sequenceStatus !== SequenceStatus.NOT_STARTED) score += 1;
  return score;
}

function buildApolloPeopleSearchKeywords(companyName: string, queryKeywords: string | null | undefined, constrainedToOrganization: boolean) {
  const trimmedKeyword = queryKeywords?.trim() ?? "";

  if (!trimmedKeyword) {
    return constrainedToOrganization ? undefined : companyName;
  }

  return constrainedToOrganization ? trimmedKeyword : `${companyName} ${trimmedKeyword}`.trim();
}

function rankApolloRelevantContacts(entries: ApolloContactRecord[]) {
  const deduped = dedupeApolloContacts(entries);
  const relevant = deduped
    .map((entry) => ({
      entry,
      roleFit: scoreApolloRoleFit(entry)
    }))
    .filter(({ roleFit }) => roleFit.accepted)
    .sort((left, right) => {
      if (left.roleFit.score !== right.roleFit.score) {
        return right.roleFit.score - left.roleFit.score;
      }

      return scoreApolloContactEntry(right.entry) - scoreApolloContactEntry(left.entry);
    })
    .map(({ entry }) => entry);

  return relevant;
}

function scoreApolloRoleFit(entry: ApolloContactRecord) {
  const roleText = [entry.title, entry.department, entry.seniority].filter(Boolean).join(" ").toLowerCase();

  if (!roleText) {
    return {
      accepted: false,
      score: 0
    };
  }

  const hasSalesOpsException = /sales and operations|operations and sales/.test(roleText);
  const isExcluded = APOLLO_EXCLUDED_ROLE_KEYWORDS.some((keyword) => roleText.includes(keyword));
  if (isExcluded && !hasSalesOpsException) {
    return {
      accepted: false,
      score: 0
    };
  }

  const primaryHit = APOLLO_PRIMARY_ROLE_KEYWORDS.some((keyword) => roleText.includes(keyword));
  const fallbackHit = APOLLO_FALLBACK_ROLE_KEYWORDS.some((keyword) => roleText.includes(keyword));

  if (!primaryHit && !fallbackHit) {
    return {
      accepted: false,
      score: 0
    };
  }

  let score = 0;
  if (primaryHit) {
    score += 38;
  } else if (fallbackHit) {
    score += 30;
  }

  if (/(chief|ceo|coo|owner|founder|president)/.test(roleText)) {
    score += 20;
  } else if (/(vp|vice president)/.test(roleText)) {
    score += 18;
  } else if (/(director|head)/.test(roleText)) {
    score += 16;
  } else if (/manager/.test(roleText)) {
    score += 11;
  }

  if (/(operations|supply chain|logistics|procurement|purchasing|distribution)/.test(roleText)) {
    score += 15;
  } else if (fallbackHit) {
    score += 8;
  }

  return {
    accepted: true,
    score
  };
}

function extractApolloError(payload: Record<string, unknown> | ApolloUsersResponse | null) {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const record = payload as Record<string, unknown>;
  const directMessage = readApolloString(record, ["message", "error", "detail"]);
  if (directMessage) {
    return directMessage;
  }

  if (record.errors && typeof record.errors === "object") {
    const nestedMessage = readApolloString(record.errors as Record<string, unknown>, ["message", "base"]);
    if (nestedMessage) {
      return nestedMessage;
    }
  }

  return null;
}

function readApolloArray(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (Array.isArray(value)) {
      return value;
    }
  }

  return [];
}

function readApolloString(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }

  return null;
}

function readApolloBoolean(record: Record<string, unknown>, keys: string[], fallback: boolean) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "boolean") {
      return value;
    }
  }

  return fallback;
}

function readApolloNumber(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === "string" && value.trim().length > 0) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }

  return null;
}

function classifyApolloActivity(record: Record<string, unknown>): ApolloActivityKind {
  const descriptor = [
    readApolloString(record, ["type", "activity_type", "kind", "category"]),
    readApolloString(record, ["event_type", "task_type"]),
    readApolloString(record, ["status", "call_status"]),
    readApolloString(record, ["outcome", "disposition", "call_disposition"])
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (/\b(reply|replied|response|responded|inbound email)\b/.test(descriptor)) {
    return "REPLY";
  }

  if (/\b(email sent|sent email|outbound email|message sent|mail sent)\b/.test(descriptor)) {
    return "EMAIL_SENT";
  }

  if (/\b(contact created|person created|lead created|new lead|new contact)\b/.test(descriptor)) {
    return "LEAD_CREATED";
  }

  if (/\b(call|phone|dial)\b/.test(descriptor)) {
    return isConnectedCallDescriptor(descriptor) ? "CONNECTED_CALL" : "CALL";
  }

  if (
    readApolloString(record, ["call_id", "phone_number", "to_phone_number", "from_phone_number"]) ||
    readApolloNumber(record, ["duration_seconds", "call_duration_seconds", "duration"])
  ) {
    return isConnectedCallDescriptor(descriptor) || readApolloNumber(record, ["duration_seconds", "call_duration_seconds", "duration"])
      ? "CONNECTED_CALL"
      : "CALL";
  }

  if (readApolloString(record, ["email", "recipient_email", "from_email"]) && readApolloString(record, ["subject", "email_subject"])) {
    return "EMAIL_SENT";
  }

  return "OTHER";
}

function matchesApolloUser(record: Record<string, unknown>, apolloUserId: string) {
  const directUserId = readApolloString(record, [
    "user_id",
    "owner_id",
    "created_by_id",
    "performed_by_user_id",
    "assignee_id"
  ]);

  if (directUserId) {
    return directUserId === apolloUserId;
  }

  const nestedUserIds = [record.user, record.owner, record.created_by, record.performed_by, record.assignee]
    .map(asRecord)
    .flatMap((nestedRecord) => (nestedRecord ? [readApolloString(nestedRecord, ["id", "user_id"])] : []))
    .filter(Boolean);

  return nestedUserIds.length === 0 || nestedUserIds.includes(apolloUserId);
}

function isConnectedCallDescriptor(value: string) {
  return /\b(answered|connected|completed|talked|spoke|success)\b/.test(value);
}

function buildApolloActivityTypeFilters(kinds: ApolloActivityKind[]) {
  if (kinds.includes("CALL") || kinds.includes("CONNECTED_CALL")) {
    return undefined;
  }

  const values = new Set<string>();

  for (const kind of kinds) {
    if (kind === "CALL" || kind === "CONNECTED_CALL") {
      values.add("call");
    }
    if (kind === "EMAIL_SENT") {
      values.add("email");
      values.add("email_sent");
    }
    if (kind === "REPLY") {
      values.add("reply");
      values.add("email_reply");
    }
    if (kind === "LEAD_CREATED") {
      values.add("contact");
      values.add("lead");
    }
  }

  return [...values];
}

function countApolloActivities(activities: ApolloActivityRecord[]) {
  const counts: Record<ApolloActivityKind, number> = {
    CALL: 0,
    CONNECTED_CALL: 0,
    EMAIL_SENT: 0,
    REPLY: 0,
    LEAD_CREATED: 0,
    OTHER: 0
  };

  for (const activity of activities) {
    counts[activity.kind] += 1;
  }

  return counts;
}

function dedupeApolloActivities(activities: ApolloActivityRecord[]) {
  const seen = new Set<string>();

  return activities.filter((activity) => {
    const key = activity.id ?? `${activity.kind}:${activity.occurredAt ?? ""}:${activity.subject ?? ""}:${activity.email ?? ""}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function isApolloActivityWithinDateRange(activity: ApolloActivityRecord, startDate: Date, endDate: Date) {
  if (!activity.occurredAt) {
    return true;
  }

  const occurredAt = new Date(activity.occurredAt);
  if (Number.isNaN(occurredAt.getTime())) {
    return true;
  }

  return occurredAt >= startDate && occurredAt <= endDate;
}

function buildApolloPageSignature(entries: unknown[]) {
  return JSON.stringify(
    entries.map((entry, index) => {
      const record = asRecord(entry);
      if (!record) {
        return `unknown:${index}`;
      }

      const identifier =
        readApolloString(record, ["id", "phone_call_id", "call_id", "conversation_id", "message_id", "emailer_message_id"]) ??
        [
          readApolloString(record, ["created_at", "started_at", "completed_at", "updated_at"]),
          readApolloString(record, ["email", "to_email", "recipient_email"]),
          readApolloString(record, ["subject", "title"])
        ]
          .filter(Boolean)
          .join(":");

      return identifier || `unknown:${index}`;
    })
  );
}

function readApolloActivityEntries(payload: Record<string, unknown>) {
  return [
    ...readApolloArray(payload, ["activities"]),
    ...readApolloArray(payload, ["activity_logs"]),
    ...readApolloArray(payload, ["calls"]),
    ...readApolloArray(payload, ["phone_calls"]),
    ...readApolloArray(payload, ["conversations"]),
    ...readApolloArray(payload, ["emails"]),
    ...readApolloArray(payload, ["emailer_messages"]),
    ...readApolloArray(payload, ["replies"]),
    ...readApolloArray(payload, ["contacts"]),
    ...readApolloArray(payload, ["people"]),
    ...readApolloArray(payload, ["data"])
  ];
}

function toApolloPhoneCallActivity(record: Record<string, unknown>): ApolloActivityRecord | null {
  const id = readApolloString(record, ["id", "phone_call_id", "call_id"]);
  const occurredAt = readApolloString(record, ["started_at", "created_at", "completed_at", "updated_at"]);

  if (!id && !occurredAt) {
    return null;
  }

  return {
    id,
    kind: "CALL",
    type: readApolloString(record, ["type", "call_type"]),
    status: readApolloString(record, ["status", "disposition", "call_disposition"]),
    outcome: readApolloString(record, ["outcome", "result", "disposition"]),
    durationSeconds: readApolloNumber(record, ["duration", "duration_seconds", "call_duration_seconds"]),
    occurredAt,
    contactName: readApolloString(record, ["contact_name", "prospect_name", "name"]),
    companyName: readApolloString(record, ["organization_name", "company_name", "account_name"]),
    email: readApolloString(record, ["email", "contact_email"]),
    subject: readApolloString(record, ["subject", "title"]),
    bodyPreview: null,
    rawPayload: record
  };
}

function toApolloConversationActivity(record: Record<string, unknown>): ApolloActivityRecord | null {
  const id = readApolloString(record, ["id", "conversation_id"]);
  const occurredAt = readApolloString(record, ["started_at", "created_at", "occurred_at", "updated_at"]);

  if (!id && !occurredAt) {
    return null;
  }

  return {
    id,
    kind: "CONNECTED_CALL",
    type: readApolloString(record, ["type", "conversation_type"]),
    status: readApolloString(record, ["status"]),
    outcome: readApolloString(record, ["outcome", "result"]),
    durationSeconds: readApolloNumber(record, ["duration", "duration_seconds", "call_duration_seconds"]),
    occurredAt,
    contactName: readApolloString(record, ["contact_name", "prospect_name", "name"]),
    companyName: readApolloString(record, ["organization_name", "company_name", "account_name"]),
    email: readApolloString(record, ["email", "contact_email"]),
    subject: readApolloString(record, ["subject", "title"]),
    bodyPreview: null,
    rawPayload: record
  };
}

function toApolloEmailActivities(record: Record<string, unknown>): ApolloActivityRecord[] {
  const id = readApolloString(record, ["id", "message_id", "emailer_message_id"]);
  const status = readApolloString(record, ["status"]);
  const replyClass = readApolloString(record, ["reply_class"]);
  const replied = readApolloBoolean(record, ["replied"], false);
  const createdAt = readApolloString(record, ["created_at"]);
  const completedAt = readApolloString(record, ["completed_at", "sent_at", "updated_at"]);
  const occurredAt = completedAt ?? createdAt;
  const email = readApolloString(record, ["to_email", "recipient_email", "email"]);
  const subject = readApolloString(record, ["subject", "email_subject"]);
  const companyName = readApolloString(record, ["organization_name", "company_name", "account_name"]);
  const base = {
    id,
    type: readApolloString(record, ["type", "message_type"]),
    status,
    outcome: replyClass,
    durationSeconds: null,
    occurredAt,
    contactName: readApolloString(record, ["contact_name", "prospect_name", "name"]),
    companyName,
    email,
    subject,
    bodyPreview: readApolloString(record, ["snippet", "body_preview", "preview_text"]),
    rawPayload: record
  } satisfies Omit<ApolloActivityRecord, "kind">;

  const activities: ApolloActivityRecord[] = [];

  if (status === "completed") {
    activities.push({
      ...base,
      kind: "EMAIL_SENT"
    });
  }

  if (replied || replyClass) {
    activities.push({
      ...base,
      id: id ? `${id}:reply` : null,
      kind: "REPLY",
      occurredAt: readApolloString(record, ["replied_at", "last_reply_at", "updated_at"]) ?? occurredAt
    });
  }

  return activities;
}

function mergeApolloPayload(target: Record<string, unknown>, buckets: Map<string, unknown[]>, pagePayload: Record<string, unknown>) {
  for (const [key, value] of Object.entries(pagePayload)) {
    if (Array.isArray(value)) {
      const existing = buckets.get(key) ?? [];
      existing.push(...value);
      buckets.set(key, existing);
      continue;
    }

    if (!(key in target)) {
      target[key] = value;
    }
  }
}

function extractApolloAggregateMetrics(payload: Record<string, unknown>) {
  const metrics = {
    callCount: readApolloAggregateMetric(payload, [
      "calls logged",
      "call count",
      "calls",
      "total calls",
      "# calls logged"
    ]),
    connectedCount: readApolloAggregateMetric(payload, [
      "connected calls",
      "answered calls",
      "completed calls",
      "calls connected"
    ]),
    emailSentCount: readApolloAggregateMetric(payload, ["emails sent", "email sent", "sent emails"]),
    replyCount: readApolloAggregateMetric(payload, ["replies", "reply count", "responses"]),
    leadCreatedCount: readApolloAggregateMetric(payload, ["new leads", "leads added", "new contacts", "contacts added"])
  };

  return metrics;
}

function readApolloAggregateMetric(payload: Record<string, unknown>, labels: string[]) {
  let best: number | null = null;
  const normalizedLabels = labels.map((label) => normalizeApolloMetricLabel(label));
  const queue: unknown[] = [payload];

  while (queue.length > 0) {
    const current = queue.shift();
    const record = asRecord(current);

    if (Array.isArray(current)) {
      queue.push(...current);
      continue;
    }

    if (!record) {
      continue;
    }

    const directEntries: Array<[string[], number | null]> = [
      [["calls_logged", "call_count", "total_calls"], readApolloNumber(record, ["calls_logged", "call_count", "total_calls"])],
      [
        ["connected_calls", "answered_calls", "completed_calls"],
        readApolloNumber(record, ["connected_calls", "answered_calls", "completed_calls"])
      ],
      [["emails_sent", "email_sent_count"], readApolloNumber(record, ["emails_sent", "email_sent_count"])],
      [["reply_count", "replies_count", "responses_count"], readApolloNumber(record, ["reply_count", "replies_count", "responses_count"])],
      [["new_leads", "leads_added", "new_contacts"], readApolloNumber(record, ["new_leads", "leads_added", "new_contacts"])]
    ];

    for (const [keys, value] of directEntries) {
      if (value === null) {
        continue;
      }
      if (keys.some((key) => normalizedLabels.includes(normalizeApolloMetricLabel(key)))) {
        best = best === null ? value : Math.max(best, value);
      }
    }

    const name = readApolloString(record, ["name", "label", "metric", "metric_name", "title"]);
    const value = readApolloNumber(record, ["value", "count", "total"]);
    if (name && value !== null) {
      const normalizedName = normalizeApolloMetricLabel(name);
      if (normalizedLabels.some((label) => normalizedName.includes(label))) {
        best = best === null ? value : Math.max(best, value);
      }
    }

    for (const value of Object.values(record)) {
      if (value && typeof value === "object") {
        queue.push(value);
      }
    }
  }

  return best;
}

function normalizeApolloMetricLabel(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function formatDateInTimezone(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  if (!year || !month || !day) {
    return date.toISOString().slice(0, 10);
  }

  return `${year}-${month}-${day}`;
}

function buildName(firstName: string | null, lastName: string | null) {
  const parts = [firstName, lastName].filter((value): value is string => Boolean(value));
  return parts.length > 0 ? parts.join(" ") : null;
}

function normalizeDomain(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  return value
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/\/.*$/, "")
    .toLowerCase();
}

function buildCompanyIdentityKey(companyName: string, domain: string | null) {
  return [buildApolloSearchCompanyName(companyName), domain ?? ""].filter(Boolean).join("|");
}

export function normalizeCompanyName(value: string) {
  return value
    .toLowerCase()
    .replace(/\b(incorporated|inc|llc|ltd|limited|corp|corporation|co|company|sa|s\.a|plc|gmbh)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function buildApolloSearchCompanyName(value: string) {
  return simplifyCompanySearchName(value) || normalizeCompanyName(value);
}

function simplifyCompanySearchName(value: string) {
  return normalizeCompanyName(
    value
      .replace(/\bc\/o\b/gi, " ")
      .replace(/\bcare of\b/gi, " ")
      .replace(/\battn\b.*$/i, " ")
      .replace(/\bdba\b.*$/i, " ")
      .replace(/\bdivision of\b.*$/i, " ")
      .replace(/\bdept\b.*$/i, " ")
      .replace(/\bdepartment\b.*$/i, " ")
      .replace(/\bprocurement\b.*$/i, " ")
      .replace(/\bimport(?:s)?\b.*$/i, " ")
      .replace(/\s+-\s+.*$/i, " ")
      .replace(/\s+\|\s+.*$/i, " ")
      .replace(/\s+\/\s+.*$/i, " ")
  );
}

function buildCompanyNameAliases(value: string) {
  const aliases = new Set<string>();
  const normalized = normalizeCompanyName(value);
  const simplified = simplifyCompanySearchName(value);

  if (normalized) {
    aliases.add(normalized);
  }

  if (simplified) {
    aliases.add(simplified);
  }

  return [...aliases];
}

function buildApolloOrganizationSearchQueries(value: string) {
  const queries = [value.trim(), simplifyCompanySearchName(value), normalizeCompanyName(value)]
    .filter((query): query is string => Boolean(query && query.trim().length > 0))
    .filter((query, index, array) => array.indexOf(query) === index);

  return queries;
}

function hasExactAliasMatch(leftAliases: string[], rightAliases: string[]) {
  return leftAliases.some((left) => rightAliases.some((right) => left.length > 0 && left === right));
}

function hasPartialAliasMatch(leftAliases: string[], rightAliases: string[]) {
  return leftAliases.some((left) =>
    rightAliases.some(
      (right) =>
        left.length > 0 &&
        right.length > 0 &&
        left !== right &&
        (left.includes(right) || right.includes(left))
    )
  );
}

function hasStrongBaseNameMatch(leftAliases: string[], rightAliases: string[]) {
  return (
    hasExactAliasMatch(leftAliases, rightAliases) ||
    hasContainedLeadingTokenMatch(leftAliases, rightAliases) ||
    calculateBestTokenSimilarity(leftAliases, rightAliases) >= 0.85
  );
}

function tokenizeCompanyName(value: string) {
  return normalizeCompanyName(value)
    .split(/\s+/)
    .filter((token) => token.length > 1 && !COMPANY_STOP_WORDS.has(token));
}

function calculateBestTokenSimilarity(leftAliases: string[], rightAliases: string[]) {
  let best = 0;

  for (const left of leftAliases) {
    for (const right of rightAliases) {
      best = Math.max(best, calculateTokenSimilarity(tokenizeCompanyName(left), tokenizeCompanyName(right)));
    }
  }

  return best;
}

function calculateTokenSimilarity(left: string[], right: string[]) {
  if (left.length === 0 || right.length === 0) {
    return 0;
  }

  const leftSet = new Set(left);
  const rightSet = new Set(right);
  const shared = [...leftSet].filter((token) => rightSet.has(token)).length;
  const denominator = Math.max(leftSet.size, rightSet.size);
  return shared / denominator;
}

function hasContainedLeadingTokenMatch(leftAliases: string[], rightAliases: string[]) {
  return leftAliases.some((leftAlias) =>
    rightAliases.some((rightAlias) => isLeadingTokenBaseMatch(leftAlias, rightAlias))
  );
}

function isLeadingTokenBaseMatch(leftAlias: string, rightAlias: string) {
  const leftTokens = tokenizeCompanyName(leftAlias);
  const rightTokens = tokenizeCompanyName(rightAlias);

  if (leftTokens.length < 2 || rightTokens.length <= leftTokens.length) {
    return false;
  }

  return leftTokens.every((token, index) => rightTokens[index] === token);
}

const COMPANY_STOP_WORDS = new Set(["the", "and", "of", "for", "usa", "us", "intl", "international", "group"]);

const LOGISTICS_PROVIDER_PATTERN =
  /\b(3pl|broker|carrier|customs|distribution|drayage|forwarder|freight|fulfillment|logistic|logistics|shipping|steamship|transport|trucking|warehouse|warehousing)\b/i;

const BRANCH_LOCATION_PATTERN = /\b(branch|office|division|facility|terminal|depot|warehouse|dc|distribution center)\b/i;

function isLogisticsProviderName(value: string) {
  return LOGISTICS_PROVIDER_PATTERN.test(value);
}

function isBranchLocationMatch(candidateName: string, inputName: string) {
  if (!candidateName || !inputName) {
    return false;
  }

  return BRANCH_LOCATION_PATTERN.test(candidateName) && normalizeCompanyName(candidateName) !== normalizeCompanyName(inputName);
}

function parseSequenceStatus(value: string | null): SequenceStatus {
  const normalized = value?.toLowerCase() ?? "";

  if (!normalized) {
    return SequenceStatus.NOT_STARTED;
  }

  if (/(reply|respond)/.test(normalized)) {
    return SequenceStatus.REPLIED;
  }

  if (/bounc/.test(normalized)) {
    return SequenceStatus.BOUNCED;
  }

  if (/pause|hold/.test(normalized)) {
    return SequenceStatus.PAUSED;
  }

  if (/(finish|complete|done|ended|closed)/.test(normalized)) {
    return SequenceStatus.FINISHED;
  }

  if (/(enroll|active|running|started|in[_ -]?progress)/.test(normalized)) {
    return SequenceStatus.ENROLLED;
  }

  if (/ready/.test(normalized)) {
    return SequenceStatus.READY;
  }

  return SequenceStatus.NOT_STARTED;
}

function parseReplyStatus(value: string | null): ReplyStatus {
  const normalized = value?.toLowerCase() ?? "";

  if (!normalized) {
    return ReplyStatus.NO_REPLY;
  }

  if (normalized === "no_reply" || normalized === "no reply") {
    return ReplyStatus.NO_REPLY;
  }

  if (/(meeting|booked|scheduled)/.test(normalized)) {
    return ReplyStatus.MEETING_BOOKED;
  }

  if (/(positive|interested)/.test(normalized)) {
    return ReplyStatus.POSITIVE;
  }

  if (/(negative|not interested|unsubscribe)/.test(normalized)) {
    return ReplyStatus.NEGATIVE;
  }

  if (/(out of office|ooo|vacation)/.test(normalized)) {
    return ReplyStatus.OUT_OF_OFFICE;
  }

  if (/reply|respond/.test(normalized)) {
    return ReplyStatus.REPLIED;
  }

  return ReplyStatus.NO_REPLY;
}

function parseApolloDate(value: string | null) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function asRecord(value: unknown) {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}
