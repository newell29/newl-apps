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

export type ApolloTaskType = "call";

export type ApolloTaskRecord = {
  id: string;
  userId: string | null;
  createdAt: Date | null;
  completedAt: Date | null;
  type: string | null;
  status: string | null;
  answered: boolean | null;
  rawPayload: Record<string, unknown>;
};

export type ApolloPhoneCallRecord = {
  id: string;
  userId: string | null;
  startTime: Date | null;
  endTime: Date | null;
  status: string | null;
  logged: boolean | null;
  voicemailDropped: boolean | null;
  rawPayload: Record<string, unknown>;
};

export type ApolloConversationRecord = {
  id: string;
  hostId: string | null;
  hostName: string | null;
  startTime: Date | null;
  durationSeconds: number | null;
  state: string | null;
  conversationType: string | null;
  rawPayload: Record<string, unknown>;
};

export type ApolloEmailMessageRecord = {
  id: string;
  userId: string | null;
  createdAt: Date | null;
  completedAt: Date | null;
  status: string | null;
  type: string | null;
  replied: boolean | null;
  replyClass: string | null;
  fromEmail: string | null;
  toEmail: string | null;
  subject: string | null;
  rawPayload: Record<string, unknown>;
};

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

export async function fetchApolloTasksForUser(input: {
  apolloUserId: string;
  type: ApolloTaskType;
}): Promise<ApolloTaskRecord[]> {
  const apiKey = readApolloMasterApiKey();
  const tasks: ApolloTaskRecord[] = [];
  let page = 1;

  while (true) {
    const json = await postApolloJson("/api/v1/tasks/search", apiKey, {
      page,
      per_page: DEFAULT_PAGE_SIZE,
      user_ids: [input.apolloUserId],
      type: input.type
    });

    const pageTasks = parseApolloTasks(json);
    tasks.push(...pageTasks);

    if (pageTasks.length < DEFAULT_PAGE_SIZE) {
      break;
    }

    page += 1;
  }

  return tasks;
}

export async function fetchApolloPhoneCallsForUser(apolloUserId: string): Promise<ApolloPhoneCallRecord[]> {
  const apiKey = readApolloMasterApiKey();
  const rows: ApolloPhoneCallRecord[] = [];
  let page = 1;

  while (true) {
    const json = await postApolloJson("/api/v1/phone_calls/search", apiKey, {
      page,
      per_page: DEFAULT_PAGE_SIZE,
      user_ids: [apolloUserId]
    });

    const batch = parseApolloPhoneCalls(json);
    rows.push(...batch);

    if (batch.length < DEFAULT_PAGE_SIZE) {
      break;
    }

    page += 1;
  }

  return rows;
}

export async function fetchApolloConversationsForUser(apolloUserId: string): Promise<ApolloConversationRecord[]> {
  const apiKey = readApolloMasterApiKey();
  const rows: ApolloConversationRecord[] = [];
  let page = 1;

  while (true) {
    const json = await postApolloJson("/api/v1/conversations/search", apiKey, {
      page,
      per_page: DEFAULT_PAGE_SIZE,
      user_ids: [apolloUserId]
    });

    const batch = parseApolloConversations(json);
    rows.push(...batch);

    if (batch.length < DEFAULT_PAGE_SIZE) {
      break;
    }

    page += 1;
  }

  return rows;
}

export async function fetchApolloEmailerMessagesForUser(apolloUserId: string): Promise<ApolloEmailMessageRecord[]> {
  const apiKey = readApolloMasterApiKey();
  const rows: ApolloEmailMessageRecord[] = [];
  let page = 1;

  while (true) {
    const json = await postApolloJson("/api/v1/emailer_messages/search", apiKey, {
      page,
      per_page: DEFAULT_PAGE_SIZE,
      user_ids: [apolloUserId]
    });

    const batch = parseApolloEmailerMessages(json);
    rows.push(...batch);

    if (batch.length < DEFAULT_PAGE_SIZE) {
      break;
    }

    page += 1;
    if (page > 50) {
      break;
    }
  }

  return rows;
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

function parseApolloTasks(payload: Record<string, unknown>): ApolloTaskRecord[] {
  const candidates = readApolloArray(payload, ["tasks"]);

  return candidates.flatMap((candidate) => {
    const record = asRecord(candidate);
    const id = readApolloString(record, ["id"]);

    if (!record || !id) {
      return [];
    }

    return [
      {
        id,
        userId: readApolloString(record, ["user_id"]),
        createdAt: parseApolloDate(readApolloString(record, ["created_at"])),
        completedAt: parseApolloDate(readApolloString(record, ["completed_at"])),
        type: readApolloString(record, ["type"]),
        status: readApolloString(record, ["status"]),
        answered: readApolloBoolean(record, ["answered"], null),
        rawPayload: record
      }
    ];
  });
}

function parseApolloPhoneCalls(payload: Record<string, unknown>): ApolloPhoneCallRecord[] {
  const candidates = readApolloArray(payload, ["phone_calls"]);

  return candidates.flatMap((candidate) => {
    const record = asRecord(candidate);
    const id = readApolloString(record, ["id"]);

    if (!record || !id) {
      return [];
    }

    return [
      {
        id,
        userId: readApolloString(record, ["user_id"]),
        startTime: parseApolloDate(readApolloString(record, ["start_time"])),
        endTime: parseApolloDate(readApolloString(record, ["end_time"])),
        status: readApolloString(record, ["status"]),
        logged: readApolloNullableBoolean(record, ["logged"]),
        voicemailDropped: readApolloNullableBoolean(record, ["voicemail_dropped"]),
        rawPayload: record
      }
    ];
  });
}

function parseApolloConversations(payload: Record<string, unknown>): ApolloConversationRecord[] {
  const candidates = readApolloArray(payload, ["conversations"]);

  return candidates.flatMap((candidate) => {
    const record = asRecord(candidate);
    const id = readApolloString(record, ["id"]);

    if (!record || !id) {
      return [];
    }

    return [
      {
        id,
        hostId: readApolloString(record, ["host_id"]),
        hostName: readApolloString(record, ["host"]),
        startTime: parseApolloDate(readApolloString(record, ["start_time"])),
        durationSeconds: typeof record.duration === "number" ? record.duration : null,
        state: readApolloString(record, ["state"]),
        conversationType: readApolloString(record, ["conversation_type"]),
        rawPayload: record
      }
    ];
  });
}

function parseApolloEmailerMessages(payload: Record<string, unknown>): ApolloEmailMessageRecord[] {
  const candidates = readApolloArray(payload, ["emailer_messages"]);

  return candidates.flatMap((candidate) => {
    const record = asRecord(candidate);
    const id = readApolloString(record, ["id"]);

    if (!record || !id) {
      return [];
    }

    return [
      {
        id,
        userId: readApolloString(record, ["user_id"]),
        createdAt: parseApolloDate(readApolloString(record, ["created_at"])),
        completedAt: parseApolloDate(readApolloString(record, ["completed_at"])),
        status: readApolloString(record, ["status"]),
        type: readApolloString(record, ["type"]),
        replied: readApolloNullableBoolean(record, ["replied"]),
        replyClass: readApolloString(record, ["reply_class"]),
        fromEmail: readApolloString(record, ["from_email"]),
        toEmail: readApolloString(record, ["to_email"]),
        subject: readApolloString(record, ["subject"]),
        rawPayload: record
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

function readApolloNullableBoolean(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "boolean") {
      return value;
    }
  }

  return null;
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
