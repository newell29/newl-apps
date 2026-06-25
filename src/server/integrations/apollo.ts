import { ApolloCompanyMatchClassification, ReplyStatus, SequenceStatus } from "@prisma/client";

const DEFAULT_BASE_URL = "https://api.apollo.io";
const DEFAULT_PAGE_SIZE = 100;
const APOLLO_CONTACT_PAGE_SIZE = 25;

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
  const trustedMatchedOrganization = isDirectApolloCompanyMatch(matchedOrganization) ? matchedOrganization : null;
  const preferredOrganizationId =
    trustedMatchedOrganization?.id && (!providedOrganizationId || providedOrganizationId === trustedMatchedOrganization.id)
      ? trustedMatchedOrganization.id
      : null;

  let contactsFromApollo =
    trustedMatchedOrganization
      ? ((await searchApolloContacts({
          apiKey,
          companyName: input.companyName,
          domain: input.domain,
          organizationId: preferredOrganizationId
        })) ??
        (await searchApolloPeople({
          apiKey,
          companyName: input.companyName,
          domain: input.domain,
          organizationId: preferredOrganizationId
        })) ??
        [])
      : [];

  if (contactsFromApollo.length === 0 && preferredOrganizationId) {
    contactsFromApollo =
      (await searchApolloContacts({
        apiKey,
        companyName: input.companyName,
        domain: input.domain,
        organizationId: null
      })) ??
      (await searchApolloPeople({
        apiKey,
        companyName: input.companyName,
        domain: input.domain,
        organizationId: null
      })) ??
      [];
  }

  return {
    organizationId: trustedMatchedOrganization?.id ?? null,
    companyName: trustedMatchedOrganization?.name ?? input.companyName,
    domain: trustedMatchedOrganization?.domain ?? normalizeDomain(input.domain),
    linkedinUrl: trustedMatchedOrganization?.linkedinUrl ?? null,
    match: toApolloCompanyLookupMatch(matchedOrganization, input.companyName, normalizeDomain(input.domain)),
    contacts: dedupeApolloContacts(contactsFromApollo)
  };
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
  const body = {
    page: 1,
    per_page: 10,
    q_organization_domains: normalizedDomain ? [normalizedDomain] : undefined,
    best_company_name: input.companyName,
    company_match_name: input.companyName,
    company_identity_key: buildCompanyIdentityKey(input.companyName, normalizedDomain)
  };

  const json = await postApolloJson("/api/v1/mixed_companies/search", apiKey, body);
  const candidates = parseApolloOrganizations(json);

  if (candidates.length === 0) {
    return null;
  }

  return (
    candidates
      .map((candidate) => scoreApolloOrganizationCandidate(candidate, input.companyName, normalizedDomain, body))
      .sort((left, right) => right.score - left.score)[0] ?? null
  );
}

async function searchApolloContacts({
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
  const normalizedDomain = normalizeDomain(domain);
  const body = {
    page: 1,
    per_page: APOLLO_CONTACT_PAGE_SIZE,
    organization_ids: organizationId ? [organizationId] : undefined,
    q_organization_domains: normalizedDomain ? [normalizedDomain] : undefined,
    q_keywords: companyName
  };

  const json = await postApolloJson("/api/v1/contacts/search", apiKey, body);
  const contacts = parseApolloContacts(json);
  return contacts.length > 0 ? contacts : null;
}

async function searchApolloPeople({
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
  const normalizedDomain = normalizeDomain(domain);
  const body = {
    page: 1,
    per_page: APOLLO_CONTACT_PAGE_SIZE,
    organization_ids: organizationId ? [organizationId] : undefined,
    q_organization_domains: normalizedDomain ? [normalizedDomain] : undefined,
    q_keywords: companyName
  };

  const json = await postApolloJson("/api/v1/mixed_people/api_search", apiKey, body);
  return parseApolloContacts(json);
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
  const normalizedInputName = inputAliases[0] ?? "";
  const normalizedCandidateName = candidateAliases[0] ?? "";
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
    tokenSimilarity
  });

  return {
    ...candidate,
    score,
    nameMatchType,
    domainMatch,
    logisticsProviderMatch,
    branchLocationMatch,
    classification,
    matchReason: buildApolloMatchReason({
      classification,
      score,
      nameMatchType,
      domainMatch,
      logisticsProviderMatch,
      branchLocationMatch,
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
  tokenSimilarity
}: {
  id: string | null;
  score: number;
  nameMatchType: ApolloOrganizationCandidate["nameMatchType"];
  domainMatch: boolean;
  logisticsProviderMatch: boolean;
  branchLocationMatch: boolean;
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

  return score > 0 ? ApolloCompanyMatchClassification.MATCH_QUALITY_REVIEW : ApolloCompanyMatchClassification.NO_MATCH;
}

function buildApolloMatchReason({
  classification,
  score,
  nameMatchType,
  domainMatch,
  logisticsProviderMatch,
  branchLocationMatch,
  tokenSimilarity
}: {
  classification: ApolloCompanyMatchClassification;
  score: number;
  nameMatchType: ApolloOrganizationCandidate["nameMatchType"];
  domainMatch: boolean;
  logisticsProviderMatch: boolean;
  branchLocationMatch: boolean;
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

  return parts.join("; ");
}

function scoreApolloContactEntry(entry: ApolloContactRecord) {
  let score = 0;
  if (entry.email) score += 4;
  if (entry.title) score += 2;
  if (entry.linkedinUrl) score += 2;
  if (entry.sequenceStatus !== SequenceStatus.NOT_STARTED) score += 1;
  return score;
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
  return hasExactAliasMatch(leftAliases, rightAliases) || calculateBestTokenSimilarity(leftAliases, rightAliases) >= 0.85;
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
