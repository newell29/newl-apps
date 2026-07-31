import { ApolloCompanyMatchClassification, ReplyStatus, SequenceStatus } from "@prisma/client";

const DEFAULT_BASE_URL = "https://api.apollo.io";
export const MANUAL_APOLLO_COMPANY_MAPPING_REASON =
  "manually confirmed from Apollo company URL";
const DEFAULT_PAGE_SIZE = 100;
const APOLLO_SAVED_CONTACT_MAX_PAGES = 20;
const APOLLO_SAVED_CONTACT_RECOVERY_LIMIT = 10;
const APOLLO_PAID_EMAIL_ENRICHMENT_LIMIT = 3;
const APOLLO_EQUIVALENT_ACCOUNT_LIMIT = 5;
const APOLLO_EQUIVALENT_ACCOUNT_QUERY_LIMIT = 4;
const APOLLO_DELIVERY_FAILURE_MAX_PAGES = 10;
const APOLLO_KEYWORD_MAX_LENGTH = 200;
const INTERNAL_SEQUENCE_KEYS = new Set([
  "hunter-email-only",
  "hunter-executive-referral",
  "houston-import-decision-maker",
  "charlotte-warehouse-decision-maker",
  "standard-logistics-outreach",
  "warehouse-capacity-outreach",
  "general-newl-group-intro"
]);
const APOLLO_PRIMARY_ROLE_KEYWORDS = [
  "logistics",
  "supply chain",
  "operations",
  "warehouse",
  "fulfillment",
  "transportation",
  "distribution",
  "shipping",
  "receiving",
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
  apolloAccountId?: string | null;
  reviewerConfirmedApolloOrganizationId?: string | null;
  verifiedIdentityContext?: string | null;
};

export type ApolloOrganizationMappingResult = {
  organizationId: string;
  companyName: string;
  domain: string | null;
  linkedinUrl: string | null;
  match: ApolloCompanyLookupMatch;
};

export type ApolloCompanyReference = {
  id: string;
  resourceType: "ACCOUNT" | "ORGANIZATION";
};

export type ApolloContactRecord = {
  recordSource: "SAVED_CONTACT" | "PEOPLE_SEARCH";
  apolloContactId: string | null;
  apolloPersonId: string | null;
  firstName: string | null;
  lastName: string | null;
  lastNameObfuscated: string | null;
  fullName: string;
  title: string | null;
  department: string | null;
  seniority: string | null;
  email: string | null;
  phone: string | null;
  linkedinUrl: string | null;
  hasEmailAvailable: boolean;
  hasPhoneAvailable: boolean;
  hasLinkedinAvailable: boolean;
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

export type ApolloDeliveryFailureKind =
  | "BOUNCE"
  | "INVALID_MX"
  | "BAD_DATA"
  | "RECIPIENT_DOMAIN"
  | "SPAM_BLOCKED"
  | "OTHER_PERMANENT";

export type ApolloSequenceDeliveryFailure = {
  apolloContactId: string | null;
  email: string | null;
  kind: ApolloDeliveryFailureKind;
  reason: string;
  rawPayload: Record<string, unknown>;
};

export type ApolloContactLookupResult = {
  organizationId: string | null;
  companyName: string | null;
  domain: string | null;
  linkedinUrl: string | null;
  match: ApolloCompanyLookupMatch;
  contacts: ApolloContactRecord[];
  contactRecovery: {
    savedContactPagesRead: number;
    maskedPeopleChecked: number;
    savedContactsRecovered: number;
    relatedAccountsChecked: number;
    relatedOrganizationScopesChecked: number;
    confirmedAccountScopesChecked: number;
    peopleSearchRawRecords: number;
    peopleSearchAcceptedRecords: number;
    vettedParentAccountsChecked: number;
    companyKeywordSearches: number;
    paidEmailEnrichmentsAttempted: number;
    paidEmailsRecovered: number;
  };
};

export type ApolloContactCreateInput = {
  firstName: string | null;
  lastName: string | null;
  fullName: string;
  title: string | null;
  email: string;
  phone: string | null;
  companyName: string;
  companyDomain: string | null;
};

export class ApolloRateLimitError extends Error {
  retryAfterMs: number | null;

  constructor(message: string, retryAfterMs: number | null = null) {
    super(message);
    this.name = "ApolloRateLimitError";
    this.retryAfterMs = retryAfterMs;
  }
}

export class ApolloTransientError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApolloTransientError";
    this.status = status;
  }
}

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

export type ApolloSequenceRemovalInput = {
  sequenceIds: string[];
  apolloContactIds: string[];
};

export type ApolloSequenceTransitionInput = ApolloSequencePushInput & {
  previousSequenceByContactId: Record<string, string | null>;
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

type ApolloTypedCustomFieldsResponse = {
  typed_custom_fields?: unknown;
  custom_fields?: unknown;
  data?: unknown;
};

export type ApolloTypedCustomFieldEntry = {
  id: string;
  name: string;
  aliases: string[];
};

export type ApolloContactCustomFieldSyncInput = {
  apolloContactId: string;
  fieldValues: Record<string, string>;
};

export type ApolloContactCustomFieldSyncResult = {
  apolloContactId: string;
  syncedFields: string[];
  missingFields: string[];
  rawPayload: Record<string, unknown>;
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

export async function fetchApolloTypedCustomFieldDirectory(): Promise<ApolloTypedCustomFieldEntry[]> {
  const apiKey = readApolloMasterApiKey();
  const response = await fetch(`${DEFAULT_BASE_URL}/api/v1/typed_custom_fields`, {
    method: "GET",
    headers: buildApolloHeaders(apiKey),
    cache: "no-store"
  });
  const json = (await response.json().catch(() => null)) as ApolloTypedCustomFieldsResponse | null;

  if (!response.ok) {
    throw new Error(extractApolloError(json as Record<string, unknown> | null) ?? `Apollo typed custom field sync failed with status ${response.status}.`);
  }

  if (!json) {
    throw new Error("Apollo typed custom field sync returned an unreadable response body.");
  }

  return parseApolloTypedCustomFieldsResponse(json);
}

export async function syncApolloContactTypedCustomFields(
  input: ApolloContactCustomFieldSyncInput
): Promise<ApolloContactCustomFieldSyncResult> {
  const apolloContactId = input.apolloContactId.trim();
  if (!apolloContactId) {
    throw new Error("Apollo contact sync requires an Apollo contact ID.");
  }

  const requestedFields = Object.entries(input.fieldValues)
    .map(([name, value]) => [name.trim(), value.trim()] as const)
    .filter(([name, value]) => name.length > 0 && value.length > 0);

  if (requestedFields.length === 0) {
    throw new Error("Apollo contact sync requires at least one non-empty custom field value.");
  }

  const apiKey = readApolloMasterApiKey();
  const directory = await fetchApolloTypedCustomFieldDirectory();
  const typedCustomFields = new Map<string, string>();
  const syncedFields: string[] = [];
  const missingFields: string[] = [];

  for (const [fieldName, value] of requestedFields) {
    const matchedField = findApolloTypedCustomField(directory, fieldName);
    if (!matchedField) {
      missingFields.push(fieldName);
      continue;
    }

    typedCustomFields.set(matchedField.id, value);
    syncedFields.push(fieldName);
  }

  if (typedCustomFields.size === 0) {
    throw new Error(
      `Apollo typed custom fields could not be resolved for: ${missingFields.join(", ")}.`
    );
  }

  const fieldEntries = [...typedCustomFields.entries()].map(([fieldId, value]) => ({
    typed_custom_field_id: fieldId,
    value
  }));

  const patchAttempts: Array<Record<string, unknown>> = [
    {
      typed_custom_fields: Object.fromEntries(typedCustomFields)
    },
    {
      typed_custom_fields: fieldEntries
    }
  ];

  let rawPayload: Record<string, unknown> | null = null;
  let lastError: Error | null = null;

  for (const attempt of patchAttempts) {
    try {
      rawPayload = await patchApolloJson(`/api/v1/contacts/${apolloContactId}`, apiKey, attempt);
      break;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("Apollo typed custom field sync failed.");
    }
  }

  if (!rawPayload) {
    throw lastError ?? new Error("Apollo typed custom field sync failed.");
  }

  return {
    apolloContactId,
    syncedFields,
    missingFields,
    rawPayload
  };
}

export async function fetchApolloContactsForCompany(
  input: ApolloCompanyLookupInput,
  options?: {
    allowPeopleSearchFallback?: boolean;
    keywordSearchLimit?: number;
    authorizePaidEmailEnrichment?: boolean;
    explicitApolloPersonIds?: string[];
  }
): Promise<ApolloContactLookupResult> {
  const apiKey = readApolloSearchApiKey();
  const allowPeopleSearchFallback = options?.allowPeopleSearchFallback ?? true;
  const keywordSearchLimit = options?.keywordSearchLimit ?? APOLLO_PRIMARY_ROLE_KEYWORDS.length + APOLLO_FALLBACK_ROLE_KEYWORDS.length;
  const contactRecovery = {
    savedContactPagesRead: 0,
    maskedPeopleChecked: 0,
    savedContactsRecovered: 0,
    relatedAccountsChecked: 0,
    relatedOrganizationScopesChecked: 0,
    confirmedAccountScopesChecked: 0,
    peopleSearchRawRecords: 0,
    peopleSearchAcceptedRecords: 0,
    vettedParentAccountsChecked: 0,
    companyKeywordSearches: 0,
    paidEmailEnrichmentsAttempted: 0,
    paidEmailsRecovered: 0
  };
  const providedOrganizationId =
    input.apolloOrganizationId?.trim() && input.apolloOrganizationId !== "null"
      ? input.apolloOrganizationId.trim()
      : null;
  const providedAccountId =
    input.apolloAccountId?.trim() && input.apolloAccountId !== "null"
      ? input.apolloAccountId.trim()
      : null;
  const providedOrganization = providedOrganizationId
    ? buildTrustedProvidedApolloOrganization(input, providedOrganizationId)
    : null;
  const confirmedSavedAccount = providedAccountId
    ? await findApolloSavedAccountOrganization(
        input,
        apiKey,
        providedAccountId,
        { reviewerConfirmed: true }
      )
    : null;
  // A reviewer-confirmed /accounts/{id} URL is authoritative. Apollo People
  // Search accepts the exact account's linked organization ID, not the saved
  // account ID itself. Resolve only that account and never substitute a parent,
  // sibling, same-domain, or similarly named company.
  const discoveredOrganization = confirmedSavedAccount || providedAccountId
    ? null
    : await findApolloOrganization(input, apiKey);
  const canonicalDiscoveredOrganization =
    providedOrganizationId &&
    discoveredOrganization?.id &&
    discoveredOrganization.id !== providedOrganizationId &&
    isSafeCanonicalApolloOrganizationResolution(discoveredOrganization, input)
      ? {
          ...discoveredOrganization,
          matchReason:
            `${discoveredOrganization.matchReason}; resolved the saved Apollo account ID ` +
            `to Apollo's canonical organization ID before employee search`
        }
      : null;
  const matchedOrganization =
    confirmedSavedAccount ??
    canonicalDiscoveredOrganization ??
    providedOrganization ??
    discoveredOrganization;
  let effectiveMatchOrganization = matchedOrganization;
  let trustedMatchedOrganization = isDirectApolloCompanyMatch(matchedOrganization) ? matchedOrganization : null;
  let organizationIdForSearch = trustedMatchedOrganization?.id ?? providedOrganizationId ?? null;
  let companyNameForSearch = trustedMatchedOrganization?.name ?? input.companyName;
  let domainForSearch = trustedMatchedOrganization?.domain ?? normalizeDomain(input.domain);
  const confirmedSavedContactCompanyName =
    trustedMatchedOrganization?.name ?? input.companyName;
  const confirmedSavedContactDomain =
    trustedMatchedOrganization?.domain ?? normalizeDomain(input.domain);
  const providedReviewerConfirmedOrganizationId =
    input.reviewerConfirmedApolloOrganizationId?.trim() &&
    input.reviewerConfirmedApolloOrganizationId !== "null"
      ? input.reviewerConfirmedApolloOrganizationId.trim()
      : null;
  const trustReviewerConfirmedPeopleScope = Boolean(
    providedOrganizationId &&
    (
      (
        providedAccountId &&
        confirmedSavedAccount
      ) ||
      providedReviewerConfirmedOrganizationId === providedOrganizationId
    )
  );
  const rawSavedContactsForProvidedOrganization = providedOrganizationId
    ? ((await searchApolloContacts({
        apiKey,
        companyName: confirmedSavedContactCompanyName,
        domain: confirmedSavedContactDomain,
        organizationId: null,
        queryKeywords: null,
        enforceExpectedOrganization: false,
        contactRecovery
      })) ?? [])
    : null;
  const savedContactsForProvidedOrganization =
    rawSavedContactsForProvidedOrganization
      ? filterApolloSavedContactsForConfirmedMapping(
          rawSavedContactsForProvidedOrganization,
          {
            companyNames: [
              confirmedSavedContactCompanyName,
              input.companyName
            ],
            normalizedDomain: confirmedSavedContactDomain,
            organizationIds: [
              providedAccountId,
              trustedMatchedOrganization?.id
            ]
          }
        )
      : null;

  if (providedAccountId) {
    contactRecovery.confirmedAccountScopesChecked = 1;
  }

  let contactsFromApollo =
    organizationIdForSearch || input.domain
      ? ((await searchApolloRelevantPeople({
          apiKey,
          companyName: companyNameForSearch,
          domain: organizationIdForSearch ? null : domainForSearch,
          expectedOrganizationDomain: domainForSearch,
          organizationId: organizationIdForSearch,
          allowPeopleSearchFallback,
          keywordSearchLimit,
          enforceExpectedOrganization: true,
          trustExactOrganizationScope: trustReviewerConfirmedPeopleScope,
          savedContacts: savedContactsForProvidedOrganization,
          contactRecovery
        })) ??
        [])
      : [];

  const organizationScopedContactCount = contactsFromApollo.length;

  if (
    providedAccountId &&
    providedOrganization &&
    providedOrganizationId !== organizationIdForSearch &&
    contactsFromApollo.length === 0
  ) {
    // Apollo Account View can return a saved-account shell without embedding
    // its linked global organization. In that response shape the parsed
    // candidate ID is the account ID, while Newl already retains the global
    // organization ID resolved when the reviewer mapped the exact account URL.
    // Retry only that immutable stored ID. This remains inside the reviewer-
    // confirmed account identity and never substitutes a parent, sibling,
    // same-domain account, or keyword match.
    contactRecovery.confirmedAccountScopesChecked += 1;
    const linkedOrganizationContacts =
      (await searchApolloRelevantPeople({
        apiKey,
        companyName: confirmedSavedAccount?.name ?? input.companyName,
        domain: null,
        expectedOrganizationDomain:
          confirmedSavedAccount?.domain ?? domainForSearch,
        organizationId: providedOrganizationId,
        allowPeopleSearchFallback,
        keywordSearchLimit,
        enforceExpectedOrganization: true,
        trustExactOrganizationScope: trustReviewerConfirmedPeopleScope,
        savedContacts: savedContactsForProvidedOrganization,
        contactRecovery
      })) ?? [];

    if (linkedOrganizationContacts.length > 0) {
      organizationIdForSearch = providedOrganizationId;
      companyNameForSearch =
        confirmedSavedAccount?.name ?? input.companyName;
      trustedMatchedOrganization = {
        ...(confirmedSavedAccount ?? providedOrganization),
        id: providedOrganizationId
      };
      effectiveMatchOrganization = {
        ...trustedMatchedOrganization,
        matchReason:
          `${trustedMatchedOrganization.matchReason}; recovered employees through the ` +
          `stored global organization ID linked to the reviewer-confirmed Apollo account`
      };
      contactsFromApollo = linkedOrganizationContacts;
    }
  }

  if (
    providedAccountId &&
    providedOrganizationId &&
    contactsFromApollo.length === 0
  ) {
    // Apollo can retain more than one saved Account row for the same global
    // organization. The reviewer-confirmed row may be an empty legal-name
    // shell while saved contacts live under a short operating-brand Account
    // such as "CGT". Preserve the reviewer's mapping, but recover contacts
    // from another saved Account only when Apollo explicitly links that
    // Account to the exact same immutable global organization ID.
    const equivalentAccounts =
      await findApolloEquivalentSavedAccountsForOrganization({
        input,
        apiKey,
        providedAccountId,
        providedOrganizationId,
        confirmedSavedAccount
      });
    const supportingAccountIds: string[] = [];

    for (const equivalentAccount of equivalentAccounts) {
      contactRecovery.relatedAccountsChecked += 1;
      supportingAccountIds.push(equivalentAccount.accountId);
      const rawEquivalentContacts =
        (await searchApolloContacts({
          apiKey,
          companyName: equivalentAccount.accountName,
          domain:
            equivalentAccount.organization.domain ??
            confirmedSavedContactDomain,
          organizationId: null,
          queryKeywords: null,
          enforceExpectedOrganization: false,
          contactRecovery
        })) ?? [];
      const equivalentContacts =
        filterApolloSavedContactsForConfirmedMapping(
          rawEquivalentContacts,
          {
            companyNames: [
              equivalentAccount.accountName,
              equivalentAccount.organization.name ?? "",
              confirmedSavedContactCompanyName,
              input.companyName
            ],
            normalizedDomain:
              equivalentAccount.organization.domain ??
              confirmedSavedContactDomain,
            organizationIds: [
              equivalentAccount.accountId,
              providedAccountId,
              providedOrganizationId
            ]
          }
        );
      contactsFromApollo = dedupeApolloContacts([
        ...contactsFromApollo,
        ...equivalentContacts
      ]);

      if (contactsFromApollo.length > 0) {
        break;
      }
    }

    if (
      supportingAccountIds.length > 0 &&
      effectiveMatchOrganization
    ) {
      effectiveMatchOrganization = {
        ...effectiveMatchOrganization,
        matchReason:
          `${effectiveMatchOrganization.matchReason}; checked ` +
          `${supportingAccountIds.length} equivalent saved Apollo account` +
          `${supportingAccountIds.length === 1 ? "" : "s"} linked to the same global organization` +
          `${contactsFromApollo.length > 0 ? " and recovered saved contacts" : ""}`,
        query: {
          ...effectiveMatchOrganization.query,
          equivalent_saved_account_ids: supportingAccountIds
        },
        rawPayload: {
          ...effectiveMatchOrganization.rawPayload,
          newlEquivalentSavedAccountIds: supportingAccountIds
        }
      };
    }
  }

  if (
    !providedAccountId &&
    !canonicalDiscoveredOrganization &&
    providedOrganizationId &&
    contactsFromApollo.length <= 1
  ) {
    const savedAccountOrganization =
      confirmedSavedAccount ??
      await findApolloSavedAccountOrganization(
        input,
        apiKey,
        providedOrganizationId
      );
    const savedAccountId = readApolloString(savedAccountOrganization?.rawPayload ?? {}, ["id"]);
    const recoveredOrganizationId =
      savedAccountOrganization?.id &&
      savedAccountOrganization.id !== savedAccountId
        ? savedAccountOrganization.id
        : null;
    const recoveredDomain = savedAccountOrganization?.domain ?? domainForSearch;
    const recoveryChangesScope =
      Boolean(recoveredOrganizationId && recoveredOrganizationId !== organizationIdForSearch) ||
      Boolean(
        !recoveredOrganizationId &&
        recoveredDomain &&
        (
          recoveredDomain !== domainForSearch ||
          organizationIdForSearch === providedOrganizationId
        )
      );

    if (savedAccountOrganization && recoveryChangesScope) {
      trustedMatchedOrganization = savedAccountOrganization;
      effectiveMatchOrganization = {
        ...savedAccountOrganization,
        matchReason:
          `${savedAccountOrganization.matchReason}; recovered from Apollo's saved-account directory ` +
          `after the original employee search returned ${contactsFromApollo.length} result(s)`
      };
      organizationIdForSearch = recoveredOrganizationId;
      companyNameForSearch = savedAccountOrganization.name ?? input.companyName;
      domainForSearch = recoveredDomain;
      contactsFromApollo =
        (await searchApolloRelevantPeople({
          apiKey,
          companyName: companyNameForSearch,
          domain: organizationIdForSearch ? null : domainForSearch,
          expectedOrganizationDomain: domainForSearch,
          organizationId: organizationIdForSearch,
          allowPeopleSearchFallback,
          keywordSearchLimit,
          enforceExpectedOrganization: true,
          savedContacts: savedContactsForProvidedOrganization,
          contactRecovery
        })) ?? [];
    }
  }

  const confirmedAccountDomain =
    confirmedSavedAccount?.domain ??
    trustedMatchedOrganization?.domain ??
    domainForSearch ??
    normalizeDomain(input.domain);
  if (
    !providedAccountId &&
    providedOrganizationId &&
    organizationIdForSearch &&
    confirmedAccountDomain &&
    contactsFromApollo.length === 0
  ) {
    const domainContacts =
      (await searchApolloRelevantPeople({
        apiKey,
        companyName: confirmedSavedAccount?.name ?? companyNameForSearch,
        domain: confirmedAccountDomain,
        expectedOrganizationDomain: confirmedAccountDomain,
        organizationId: null,
        allowPeopleSearchFallback,
        keywordSearchLimit,
        enforceExpectedOrganization: true,
        savedContacts: savedContactsForProvidedOrganization,
        contactRecovery
      })) ?? [];
    contactsFromApollo = dedupeApolloContacts([
      ...contactsFromApollo,
      ...domainContacts
    ]);
    domainForSearch = confirmedAccountDomain;
    if (effectiveMatchOrganization && domainContacts.length > 0) {
      effectiveMatchOrganization = {
        ...effectiveMatchOrganization,
        domain: effectiveMatchOrganization.domain ?? confirmedAccountDomain,
        matchReason:
          `${effectiveMatchOrganization.matchReason}; recovered employees through the ` +
          `confirmed Apollo ${providedAccountId ? "account" : "company"} domain after the organization-scoped search returned ` +
          `${organizationScopedContactCount} result(s)`
      };
    }
  }

  if (
    !providedAccountId &&
    providedOrganizationId &&
    contactsFromApollo.length <= 1 &&
    savedContactsForProvidedOrganization &&
    savedContactsForProvidedOrganization.length > 0
  ) {
    const trustedContactDomain = inferTrustedApolloDomainFromContacts(
      savedContactsForProvidedOrganization,
      input.companyName
    );
    if (
      trustedContactDomain &&
      (
        trustedContactDomain !== domainForSearch ||
        organizationIdForSearch === providedOrganizationId
      )
    ) {
      const domainContacts =
        (await searchApolloRelevantPeople({
          apiKey,
          companyName: input.companyName,
          domain: trustedContactDomain,
          expectedOrganizationDomain: trustedContactDomain,
          organizationId: null,
          allowPeopleSearchFallback,
          keywordSearchLimit,
          enforceExpectedOrganization: true,
          savedContacts: savedContactsForProvidedOrganization,
          contactRecovery
        })) ?? [];
      contactsFromApollo = dedupeApolloContacts([
        ...contactsFromApollo,
        ...domainContacts
      ]);
      domainForSearch = trustedContactDomain;
      if (effectiveMatchOrganization) {
        effectiveMatchOrganization = {
          ...effectiveMatchOrganization,
          domain: effectiveMatchOrganization.domain ?? trustedContactDomain,
          matchReason:
            `${effectiveMatchOrganization.matchReason}; expanded the partial employee result ` +
            `through the confirmed account's trusted saved-contact domain`
        };
      }
    }
  }

  let blockedByRecoveryAmbiguity = false;
  if (
    !providedAccountId &&
    !canonicalDiscoveredOrganization &&
    providedOrganizationId &&
    organizationIdForSearch &&
    rawSavedContactsForProvidedOrganization &&
    rawSavedContactsForProvidedOrganization.length > 0
  ) {
    const recoveredOrganization = inferApolloOrganizationFromContacts(
      rawSavedContactsForProvidedOrganization,
      input.companyName,
      normalizeDomain(input.domain)
    );
    const returnedOrganization = inferApolloOrganizationFromContacts(
      contactsFromApollo,
      input.companyName,
      normalizeDomain(input.domain)
    );
    const providedIdentifierLooksStale =
      contactsFromApollo.length === 0 ||
      (
        recoveredOrganization?.id &&
        recoveredOrganization.id !== providedOrganizationId &&
        returnedOrganization?.id === recoveredOrganization.id
      );
    if (
      providedIdentifierLooksStale &&
      recoveredOrganization?.id &&
      recoveredOrganization.id !== providedOrganizationId &&
      isDirectApolloCompanyMatch(recoveredOrganization)
    ) {
      trustedMatchedOrganization = recoveredOrganization;
      effectiveMatchOrganization = {
        ...recoveredOrganization!,
        matchReason:
          `${recoveredOrganization!.matchReason}; recovered Apollo's global organization ID ` +
          `after the configured ID returned no employees`
      };
      organizationIdForSearch = recoveredOrganization.id;
      companyNameForSearch = recoveredOrganization.name ?? input.companyName;
      domainForSearch = recoveredOrganization.domain ?? domainForSearch;
      contactsFromApollo =
        (await searchApolloRelevantPeople({
          apiKey,
          companyName: companyNameForSearch,
          domain: null,
          expectedOrganizationDomain: domainForSearch,
          organizationId: organizationIdForSearch,
          allowPeopleSearchFallback,
          keywordSearchLimit,
          enforceExpectedOrganization: true,
          savedContacts: savedContactsForProvidedOrganization,
          contactRecovery
        })) ?? [];
    } else if (
      providedIdentifierLooksStale &&
      recoveredOrganization?.id &&
      recoveredOrganization.id !== providedOrganizationId
    ) {
      trustedMatchedOrganization = null;
      effectiveMatchOrganization = recoveredOrganization;
      contactsFromApollo = [];
      blockedByRecoveryAmbiguity = true;
    }
  }

  if (contactsFromApollo.length === 0 && !trustedMatchedOrganization && !blockedByRecoveryAmbiguity) {
    contactsFromApollo =
      (await searchApolloRelevantPeople({
        apiKey,
        companyName: input.companyName,
        domain: input.domain,
        organizationId: null,
        allowPeopleSearchFallback,
        keywordSearchLimit,
        enforceExpectedOrganization: false,
        savedContacts: null,
        contactRecovery
      })) ??
      [];
  }

  if (allowPeopleSearchFallback && contactsFromApollo.length > 0) {
    contactsFromApollo = await recoverConcreteApolloEmails({
      apiKey,
      contacts: contactsFromApollo,
      companyName: companyNameForSearch,
      domain: domainForSearch,
      organizationId: organizationIdForSearch,
      enforceExpectedOrganization: Boolean(
        trustedMatchedOrganization || organizationIdForSearch || domainForSearch
      ),
      authorizePaidEmailEnrichment:
        options?.authorizePaidEmailEnrichment === true,
      contactRecovery
    });
  }

  const explicitApolloPersonIds = dedupeApolloPersonIds(
    options?.explicitApolloPersonIds ?? []
  );
  if (explicitApolloPersonIds.length > 0) {
    if (options?.authorizePaidEmailEnrichment !== true) {
      throw new Error(
        "Authorize email-only Apollo enrichment before resolving explicit person URLs."
      );
    }
    const explicitContacts = await enrichExplicitApolloPeople({
      personIds: explicitApolloPersonIds,
      companyName: confirmedSavedAccount?.name ?? companyNameForSearch,
      trustedDomain: confirmedAccountDomain ?? domainForSearch,
      contactRecovery
    });
    contactsFromApollo = dedupeApolloContacts([
      ...contactsFromApollo,
      ...explicitContacts
    ]);
    if (explicitContacts.length > 0 && effectiveMatchOrganization) {
      effectiveMatchOrganization = {
        ...effectiveMatchOrganization,
        matchReason:
          `${effectiveMatchOrganization.matchReason}; recovered reviewer-selected employees through ` +
          `explicit Apollo person URLs after the account roster was unavailable through the public search API`
      };
    }
  }

  if (!trustedMatchedOrganization && contactsFromApollo.length > 0) {
    const inferredOrganization = inferApolloOrganizationFromContacts(contactsFromApollo, input.companyName, normalizeDomain(input.domain));
    if (isDirectApolloCompanyMatch(inferredOrganization)) {
      trustedMatchedOrganization = inferredOrganization;
      effectiveMatchOrganization = inferredOrganization;
      contactsFromApollo = filterApolloContactsByOrganizationMatch(contactsFromApollo, input.companyName, inferredOrganization!);
    }
  }

  const match = toApolloCompanyLookupMatch(
    effectiveMatchOrganization,
    input.companyName,
    normalizeDomain(input.domain)
  );
  return {
    organizationId: trustedMatchedOrganization?.id ?? null,
    companyName: trustedMatchedOrganization?.name ?? input.companyName,
    domain: trustedMatchedOrganization?.domain ?? normalizeDomain(input.domain),
    linkedinUrl: trustedMatchedOrganization?.linkedinUrl ?? null,
    match: providedAccountId
      ? {
          ...match,
          query: {
            ...match.query,
            apollo_account_id: providedAccountId
          }
        }
      : match,
    contacts: dedupeApolloContacts(contactsFromApollo),
    contactRecovery
  };
}

export function readApolloAccountIdFromMatchQuery(value: unknown) {
  const query = asRecord(value);
  if (!query) return null;

  const explicitAccountId = readApolloString(query, [
    "apollo_account_id",
    "account_id"
  ]);
  const resourceType = readApolloString(query, ["resource_type"])?.toUpperCase();
  const suppliedAccountId =
    resourceType === "ACCOUNT"
      ? readApolloString(query, ["supplied_id"])
      : null;
  const accountId = explicitAccountId ?? suppliedAccountId;

  return accountId && /^[a-f0-9]{24}$/iu.test(accountId)
    ? accountId
    : null;
}

export function readReviewerConfirmedApolloOrganizationIdFromMatchQuery(
  value: unknown
) {
  const query = asRecord(value);
  if (!query) return null;

  const source = readApolloString(query, ["source"])?.toLowerCase();
  const resourceType = readApolloString(query, ["resource_type"])?.toUpperCase();
  if (source !== "manual-apollo-url" || resourceType !== "ORGANIZATION") {
    return null;
  }

  const suppliedOrganizationId = readApolloString(query, ["supplied_id"]);
  return suppliedOrganizationId &&
    /^[a-f0-9]{24}$/iu.test(suppliedOrganizationId)
    ? suppliedOrganizationId
    : null;
}

export function parseApolloCompanyReference(value: string): ApolloCompanyReference {
  const trimmed = value.trim();
  if (/^[a-f0-9]{24}$/iu.test(trimmed)) {
    return {
      id: trimmed,
      resourceType: "ORGANIZATION"
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("Enter a valid Apollo company URL or 24-character Apollo organization ID.");
  }

  if (parsed.hostname !== "apollo.io" && !parsed.hostname.endsWith(".apollo.io")) {
    throw new Error("The company mapping URL must be an Apollo URL.");
  }

  const candidates = [parsed.pathname, parsed.hash, ...parsed.searchParams.values()];
  for (const candidate of candidates) {
    const typedMatch = candidate.match(
      /\/(accounts|organizations)\/([a-f0-9]{24})(?:\/|$)/iu
    );
    if (typedMatch) {
      return {
        id: typedMatch[2],
        resourceType: typedMatch[1].toLowerCase() === "accounts" ? "ACCOUNT" : "ORGANIZATION"
      };
    }
  }

  for (const candidate of candidates) {
    const untypedMatch = candidate.match(/[a-f0-9]{24}/iu);
    if (untypedMatch) {
      return {
        id: untypedMatch[0],
        resourceType: "ORGANIZATION"
      };
    }
  }

  throw new Error("The Apollo company URL does not contain an organization ID.");
}

export function parseApolloOrganizationId(value: string) {
  return parseApolloCompanyReference(value).id;
}

export function parseApolloPersonIds(value: string) {
  const entries = value
    .split(/[\n,]+/u)
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (entries.length === 0) {
    return [];
  }

  const personIds = dedupeApolloPersonIds(entries.map(parseApolloPersonId));
  if (personIds.length > APOLLO_PAID_EMAIL_ENRICHMENT_LIMIT) {
    throw new Error(
      `Paste no more than ${APOLLO_PAID_EMAIL_ENRICHMENT_LIMIT} Apollo person URLs.`
    );
  }

  return personIds;
}

function parseApolloPersonId(value: string) {
  if (/^[a-f0-9]{24}$/iu.test(value)) {
    return value;
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Each Apollo person entry must be a full Apollo person URL.");
  }
  if (url.protocol !== "https:" || url.hostname !== "app.apollo.io") {
    throw new Error("Apollo person URLs must use https://app.apollo.io.");
  }
  const match = url.hash.match(/^#\/people\/([a-f0-9]{24})(?:[/?]|$)/iu);
  if (!match?.[1]) {
    throw new Error("The Apollo person URL does not contain a valid person ID.");
  }
  return match[1];
}

export async function fetchApolloOrganizationForMapping({
  companyName,
  apolloOrganizationId,
  resourceType = "ORGANIZATION",
  reviewerConfirmed = false
}: {
  companyName: string;
  apolloOrganizationId: string;
  resourceType?: ApolloCompanyReference["resourceType"];
  reviewerConfirmed?: boolean;
}): Promise<ApolloOrganizationMappingResult> {
  const apiKey = readApolloMasterApiKey();
  let canonicalOrganizationId = apolloOrganizationId;
  let accountPayload: Record<string, unknown> | null = null;
  let mappingPayload: Record<string, unknown> | null = null;

  if (resourceType === "ACCOUNT") {
    accountPayload = await getApolloJson(
      `/api/v1/accounts/${encodeURIComponent(apolloOrganizationId)}`,
      apiKey
    );
    const account =
      asRecord(accountPayload.account) ??
      asRecord(accountPayload.data) ??
      accountPayload;
    const nestedOrganization = asRecord(account.organization);
    canonicalOrganizationId =
      readApolloString(account, ["organization_id", "apollo_organization_id"]) ??
      readApolloString(nestedOrganization ?? {}, [
        "id",
        "organization_id",
        "apollo_organization_id"
      ]) ??
      "";

    if (canonicalOrganizationId) {
      const json = await getApolloJson(
        `/api/v1/organizations/${encodeURIComponent(canonicalOrganizationId)}`,
        apiKey
      );
      const organization =
        asRecord(json.organization) ??
        asRecord(json.account) ??
        asRecord(json.company) ??
        asRecord(json.data) ??
        json;
      mappingPayload = { organizations: [organization] };
    } else {
      // Some valid Apollo account pages are sparse CRM shells and do not expose a
      // global organization ID. The authenticated reviewer's exact account URL
      // remains the authoritative mapping; downstream contact recovery can use
      // the persisted account ID plus verified Hunter identity evidence.
      canonicalOrganizationId = apolloOrganizationId;
      mappingPayload = { accounts: [account] };
    }
  } else {
    const json = await getApolloJson(
      `/api/v1/organizations/${encodeURIComponent(canonicalOrganizationId)}`,
      apiKey
    );
    const organization =
      asRecord(json.organization) ??
      asRecord(json.account) ??
      asRecord(json.company) ??
      asRecord(json.data) ??
      json;
    mappingPayload = { organizations: [organization] };
  }

  const [candidate] = parseApolloOrganizations(mappingPayload ?? {});

  if (!candidate?.id || !candidate.name) {
    throw new Error("Apollo did not return a usable company for that URL.");
  }

  let scored = scoreApolloOrganizationCandidate(candidate, companyName, null, {
    source: "manual-apollo-url",
    resource_type: resourceType,
    supplied_id: apolloOrganizationId,
    organization_ids: [canonicalOrganizationId]
  });

  if (
    scored.classification !== ApolloCompanyMatchClassification.DIRECT_COMPANY &&
    resourceType === "ACCOUNT" &&
    accountPayload &&
    isSafeManualApolloAccountParentMapping({
      companyName,
      candidate,
      canonicalOrganizationId,
      accountPayload
    })
  ) {
    scored = {
      ...scored,
      score: Math.max(scored.score, 12),
      strongBaseNameMatch: true,
      classification: ApolloCompanyMatchClassification.DIRECT_COMPANY,
      matchReason:
        `direct company; manually confirmed Apollo account resolved to its canonical ` +
        `operating parent/brand "${candidate.name}"`
    };
  }

  if (
    scored.classification !== ApolloCompanyMatchClassification.DIRECT_COMPANY &&
    reviewerConfirmed
  ) {
    scored = {
      ...scored,
      classification: ApolloCompanyMatchClassification.DIRECT_COMPANY,
      matchReason:
        `direct company; authenticated reviewer explicitly confirmed the authoritative Apollo URL mapping from ` +
        `"${companyName}" to "${candidate.name}"`,
      query: {
        ...scored.query,
        reviewer_confirmed_identity_override: true,
        reviewer_confirmed_name_override: true
      }
    };
  }

  if (scored.classification !== ApolloCompanyMatchClassification.DIRECT_COMPANY) {
    if (scored.logisticsProviderMatch) {
      throw new Error(
        `Apollo URL resolved to logistics provider "${candidate.name}". Confirm the exact Apollo company URL to override automated identity matching; prospect safety is evaluated separately.`
      );
    }
    throw new Error(
      `Apollo URL resolved to "${candidate.name}", but it is not a strong enough match for "${companyName}".`
    );
  }

  return {
    organizationId: candidate.id,
    companyName: candidate.name,
    domain: candidate.domain,
    linkedinUrl: candidate.linkedinUrl,
    match: toApolloCompanyLookupMatch(scored, companyName, null)
  };
}

function isSafeManualApolloAccountParentMapping({
  companyName,
  candidate,
  canonicalOrganizationId,
  accountPayload
}: {
  companyName: string;
  candidate: {
    id: string | null;
    name: string | null;
    domain: string | null;
    linkedinUrl: string | null;
    rawPayload: Record<string, unknown>;
  };
  canonicalOrganizationId: string;
  accountPayload: Record<string, unknown>;
}) {
  const account =
    asRecord(accountPayload.account) ??
    asRecord(accountPayload.data) ??
    accountPayload;
  const nestedOrganization = asRecord(account.organization);
  const relatedOrganizationId =
    readApolloString(account, ["organization_id", "apollo_organization_id"]) ??
    readApolloString(nestedOrganization ?? {}, [
      "id",
      "organization_id",
      "apollo_organization_id"
    ]);
  if (
    !candidate.id ||
    !candidate.name ||
    relatedOrganizationId !== canonicalOrganizationId ||
    candidate.id !== canonicalOrganizationId
  ) {
    return false;
  }

  const inputTokens = new Set(
    buildCompanyNameAliases(companyName).flatMap((alias) =>
      alias.split(/\s+/u).filter(Boolean)
    )
  );
  const candidateCoreTokens = buildCompanyNameAliases(candidate.name)
    .flatMap((alias) => alias.split(/\s+/u))
    .filter(
      (token, index, values) =>
        token.length >= 5 &&
        !MANUAL_PARENT_BRAND_DESCRIPTOR_TOKENS.has(token) &&
        values.indexOf(token) === index
    );
  return (
    candidateCoreTokens.length > 0 &&
    candidateCoreTokens.every((token) => inputTokens.has(token))
  );
}

const MANUAL_PARENT_BRAND_DESCRIPTOR_TOKENS = new Set([
  "company",
  "corporation",
  "enterprises",
  "group",
  "holding",
  "holdings",
  "industries",
  "industry",
  "international",
  "manufacturing",
  "products"
]);

export async function fetchApolloContactById(apolloContactId: string): Promise<ApolloContactRecord> {
  const contactId = apolloContactId.trim();
  if (!contactId) {
    throw new Error("Apollo contact status sync requires a contact ID.");
  }

  const apiKey = readApolloMasterApiKey();
  const response = await fetch(`${DEFAULT_BASE_URL}/api/v1/contacts/${encodeURIComponent(contactId)}`, {
    method: "GET",
    headers: buildApolloHeaders(apiKey),
    cache: "no-store"
  });
  const json = (await response.json().catch(() => null)) as Record<string, unknown> | null;

  if (!response.ok) {
    const message = extractApolloError(json) ?? `Apollo contact status sync failed with status ${response.status}.`;
    if (response.status === 429 || isApolloRateLimitMessage(message)) {
      throw new ApolloRateLimitError(message, parseRetryAfterMs(response.headers.get("retry-after")));
    }
    if (response.status >= 500) {
      throw new ApolloTransientError(message, response.status);
    }
    throw new Error(message);
  }

  if (!json) {
    throw new ApolloTransientError("Apollo returned an unreadable contact response.", 502);
  }

  const record = asRecord(json.contact) ?? asRecord(json.data) ?? json;
  const contact = parseApolloContacts({ contacts: [record] }, "SAVED_CONTACT")[0];
  if (!contact) {
    throw new Error("Apollo returned a contact response without a usable contact record.");
  }

  return contact;
}

export async function fetchApolloSequenceDeliveryFailures(
  sequenceIdInput: string
): Promise<ApolloSequenceDeliveryFailure[]> {
  const sequenceId = sequenceIdInput.trim();
  if (!sequenceId) {
    throw new Error("Apollo delivery-failure reconciliation requires a sequence ID.");
  }
  if (INTERNAL_SEQUENCE_KEYS.has(sequenceId)) {
    throw new Error(
      `${sequenceId} is an internal Newl Apps cadence key, not an Apollo sequence ID.`
    );
  }

  const apiKey = readApolloMasterApiKey();
  const contacts = new Map<string, ApolloSequenceDeliveryFailure>();
  const searches = [
    {
      key: "message-status",
      messageStats: ["bounced", "failed_other", "spam_blocked"],
      notSentReasons: []
    },
    {
      key: "not-sent-reason",
      messageStats: [],
      notSentReasons: [
        "email_format_invalid",
        "email_service_provider_delivery_failure",
        "sendgrid_dropped_email",
        "mailgun_dropped_email",
        "not_valid_hard_bounce_detected",
        "email_on_global_bounce_list"
      ]
    }
  ] as const;

  for (const search of searches) {
    for (let page = 1; page <= APOLLO_DELIVERY_FAILURE_MAX_PAGES; page += 1) {
      const params = new URLSearchParams({
        page: String(page),
        per_page: String(DEFAULT_PAGE_SIZE)
      });
      params.append("emailer_campaign_ids[]", sequenceId);
      search.messageStats.forEach((value) => params.append("emailer_message_stats[]", value));
      search.notSentReasons.forEach((value) => params.append("not_sent_reason_cds[]", value));

      const response = await fetch(
        `${DEFAULT_BASE_URL}/api/v1/emailer_messages/search?${params.toString()}`,
        {
          method: "GET",
          headers: buildApolloHeaders(apiKey),
          cache: "no-store"
        }
      );
      const json = (await response.json().catch(() => null)) as Record<string, unknown> | null;

      if (!response.ok) {
        const message =
          extractApolloError(json) ??
          `Apollo delivery-failure reconciliation failed with status ${response.status}.`;
        if (response.status === 429 || isApolloRateLimitMessage(message)) {
          throw new ApolloRateLimitError(
            message,
            parseRetryAfterMs(response.headers.get("retry-after"))
          );
        }
        if (response.status >= 500) {
          throw new ApolloTransientError(message, response.status);
        }
        throw new Error(message);
      }

      if (!json) {
        throw new ApolloTransientError(
          "Apollo returned an unreadable delivery-failure response.",
          502
        );
      }

      const entries = readApolloActivityEntries(json)
        .map((entry) => asRecord(entry))
        .filter((entry): entry is Record<string, unknown> => Boolean(entry));

      for (const entry of entries) {
        const failure = classifyApolloDeliveryFailure(entry);
        if (!failure) {
          continue;
        }
        const nestedContact =
          asRecord(entry.contact) ??
          asRecord(entry.recipient) ??
          asRecord(entry.person) ??
          asRecord(entry.prospect);
        const apolloContactId =
          readApolloString(entry, [
            "contact_id",
            "apollo_contact_id",
            "recipient_contact_id",
            "prospect_id"
          ]) ?? readApolloString(nestedContact ?? {}, ["contact_id", "apollo_contact_id", "id"]);
        const email =
          readApolloString(entry, ["to_email", "recipient_email", "email"]) ??
          readApolloString(nestedContact ?? {}, ["email"]);
        const key = apolloContactId ?? email?.trim().toLowerCase() ?? null;

        if (key && !contacts.has(key)) {
          contacts.set(key, {
            apolloContactId,
            email,
            ...failure,
            rawPayload: entry
          });
        }
      }

      if (entries.length < DEFAULT_PAGE_SIZE) {
        break;
      }
    }
  }

  return [...contacts.values()];
}

export function reconcileApolloContactWithDeliveryFailureEvidence({
  contact,
  selectedSequenceId,
  apolloContactId,
  email,
  deliveryFailures
}: {
  contact: ApolloContactRecord;
  selectedSequenceId: string | null;
  apolloContactId: string;
  email: string | null;
  deliveryFailures: ApolloSequenceDeliveryFailure[];
}): ApolloContactRecord {
  if (!selectedSequenceId) {
    return contact;
  }

  const normalizedEmail = email?.trim().toLowerCase() ?? null;
  const failure = deliveryFailures.find(
    (candidate) =>
      candidate.apolloContactId === apolloContactId ||
      (normalizedEmail && candidate.email?.trim().toLowerCase() === normalizedEmail)
  );
  if (!failure) {
    return contact;
  }

  return {
    ...contact,
    sequenceStatus: SequenceStatus.BOUNCED,
    sequenceId: selectedSequenceId,
    rawPayload: {
      ...contact.rawPayload,
      newlDeliveryFailureReconciliation: {
        source: "APOLLO_OUTREACH_EMAIL_SEARCH",
        sequenceId: selectedSequenceId,
        kind: failure.kind,
        reason: failure.reason,
        record: failure.rawPayload
      }
    }
  };
}

export function classifyApolloDeliveryFailure(
  value: Record<string, unknown>
): { kind: ApolloDeliveryFailureKind; reason: string } | null {
  const records = [
    value,
    asRecord(value.delivery),
    asRecord(value.emailer_message),
    asRecord(value.message)
  ].filter((record): record is Record<string, unknown> => Boolean(record));
  const reason =
    records
      .map((record) =>
        readApolloString(record, [
          "failure_reason",
          "not_sent_reason",
          "not_sent_reason_cd",
          "delivery_failure_reason",
          "status_reason",
          "error_message",
          "message"
        ])
      )
      .find(Boolean) ??
    records
      .map((record) =>
        readApolloString(record, [
          "emailer_message_stat",
          "emailer_message_status",
          "email_status",
          "email_delivery_status",
          "status",
          "state"
        ])
      )
      .find(Boolean) ??
    "";
  const searchable = records
    .flatMap((record) =>
      [
        "failure_reason",
        "not_sent_reason",
        "not_sent_reason_cd",
        "delivery_failure_reason",
        "status_reason",
        "error_message",
        "message",
        "emailer_message_stat",
        "emailer_message_status",
        "email_status",
        "email_delivery_status",
        "status",
        "state"
      ].map((key) => readApolloString(record, [key]))
    )
    .filter(Boolean)
    .join(" | ")
    .toLowerCase();

  if (!searchable) {
    return null;
  }
  if (/invalid[-_ ]?mx|mx record|no mx|domain.*mx/.test(searchable)) {
    return { kind: "INVALID_MX", reason: reason || "Invalid MX record detected for the recipient domain." };
  }
  if (/recipient[-_ ]?domain|invalid domain|domain does not exist|email domain/.test(searchable)) {
    return { kind: "RECIPIENT_DOMAIN", reason: reason || "Recipient-domain delivery failure." };
  }
  if (/bad data|email[-_ ]?format[-_ ]?invalid|invalid email|email unverified/.test(searchable)) {
    return { kind: "BAD_DATA", reason: reason || "Apollo marked the recipient as bad data." };
  }
  if (/spam[-_ ]?blocked/.test(searchable)) {
    return { kind: "SPAM_BLOCKED", reason: reason || "Apollo blocked the message as spam." };
  }
  if (/bounc|hard[-_ ]?bounce|global[-_ ]?bounce/.test(searchable)) {
    return { kind: "BOUNCE", reason: reason || "Apollo reported a bounced message." };
  }
  if (
    /failed_other|delivery failure|delivery_failure|dropped_email|dropped email|email_service_provider_delivery_failure/.test(
      searchable
    )
  ) {
    return { kind: "OTHER_PERMANENT", reason: reason || "Apollo reported a permanent delivery failure." };
  }

  return null;
}

export async function createApolloContactForEnrollment(
  input: ApolloContactCreateInput
): Promise<ApolloContactRecord> {
  const email = input.email.trim().toLowerCase();
  if (!email) {
    throw new Error("Apollo contact creation requires a concrete email address.");
  }

  const apiKey = readApolloMasterApiKey();
  const firstName = safeApolloContactNamePart(input.firstName);
  const lastName = safeApolloContactNamePart(input.lastName);
  const websiteUrl = buildApolloContactWebsiteUrl(input.companyDomain);
  const json = await postApolloJson("/api/v1/contacts", apiKey, {
    first_name: firstName ?? undefined,
    last_name: lastName ?? undefined,
    organization_name: input.companyName.trim(),
    title: input.title?.trim() || undefined,
    email,
    website_url: websiteUrl ?? undefined,
    direct_phone: input.phone?.trim() || undefined,
    run_dedupe: true
  });
  const record =
    asRecord(json.contact) ??
    asRecord(json.data) ??
    json;
  const contact = parseApolloContacts({ contacts: [record] }, "SAVED_CONTACT")[0];

  if (!contact?.apolloContactId) {
    throw new Error("Apollo created or matched the contact but did not return a usable contact ID.");
  }

  const returnedEmail = contact.email?.trim().toLowerCase() ?? null;
  if (returnedEmail && returnedEmail !== email) {
    throw new Error(
      "Apollo deduplication returned a different email address. Review the contact in Apollo before enrollment."
    );
  }

  return {
    ...contact,
    email: contact.email ?? email,
    fullName: contact.fullName || input.fullName
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
  if (INTERNAL_SEQUENCE_KEYS.has(sequenceId)) {
    throw new Error(
      `${sequenceId} is an internal Newl Apps cadence key, not an Apollo sequence ID. ` +
        "Resolve the live Apollo cadence before enrollment."
    );
  }

  if (!sequenceOwnerUserId) {
    throw new Error("Apollo sequence push requires a mapped Apollo owner user ID.");
  }

  if (!sendFromEmailAccountId) {
    throw new Error("Apollo sequence push requires a mapped Apollo send-from email account ID.");
  }

  const initialStatus = input.initialStatus ?? "active";
  const params = new URLSearchParams({
    emailer_campaign_id: sequenceId,
    send_email_from_email_account_id: sendFromEmailAccountId,
    sequence_no_email: "false",
    sequence_unverified_email: "false",
    sequence_job_change: "false",
    sequence_active_in_other_campaigns: "true",
    sequence_finished_in_other_campaigns: "true",
    sequence_same_company_in_same_campaign: "true",
    contacts_without_ownership_permission: "true",
    add_if_in_queue: "true",
    contact_verification_skipped: "false",
    user_id: sequenceOwnerUserId,
    status: initialStatus
  });
  acceptedContactIds.forEach((contactId) => params.append("contact_ids[]", contactId));

  const rawPayload = await postApolloJson(
    `/api/v1/emailer_campaigns/${sequenceId}/add_contact_ids?${params.toString()}`,
    apiKey,
    {}
  );
  const responseError = extractApolloSequencePushError(rawPayload);
  if (responseError) {
    throw new Error(responseError);
  }

  return {
    sequenceId,
    acceptedContactIds,
    message: extractApolloError(rawPayload) ?? null,
    rawPayload
  };
}

function extractApolloSequencePushError(payload: Record<string, unknown>) {
  const success = payload.success;
  const explicitError = readApolloString(payload, ["error", "detail"]);
  if (explicitError) {
    return explicitError;
  }

  if (payload.errors && typeof payload.errors === "object") {
    const nestedMessage = readApolloString(payload.errors as Record<string, unknown>, [
      "message",
      "base",
      "detail"
    ]);
    if (nestedMessage) {
      return nestedMessage;
    }
  }

  return success === false ? readApolloString(payload, ["message"]) ?? "Apollo rejected the sequence enrollment." : null;
}

function safeApolloContactNamePart(value: string | null) {
  const normalized = value?.trim() ?? "";
  if (!normalized || /[*•●]/u.test(normalized)) {
    return null;
  }
  return normalized;
}

function buildApolloContactWebsiteUrl(domain: string | null) {
  const normalizedDomain = normalizeDomain(domain);
  return normalizedDomain ? `https://${normalizedDomain}` : null;
}

export async function removeApolloContactsFromSequences(
  input: ApolloSequenceRemovalInput
) {
  const apiKey = readApolloMasterApiKey();
  const sequenceIds = [...new Set(input.sequenceIds.map((value) => value.trim()).filter(Boolean))];
  const contactIds = [...new Set(input.apolloContactIds.map((value) => value.trim()).filter(Boolean))];
  if (sequenceIds.length === 0 || contactIds.length === 0) {
    throw new Error("Apollo sequence removal requires sequence and contact IDs.");
  }

  const params = new URLSearchParams({ mode: "remove" });
  sequenceIds.forEach((value) => params.append("emailer_campaign_ids[]", value));
  contactIds.forEach((value) => params.append("contact_ids[]", value));
  const response = await fetch(
    `${DEFAULT_BASE_URL}/api/v1/emailer_campaigns/remove_or_stop_contact_ids?${params.toString()}`,
    {
      method: "POST",
      headers: buildApolloHeaders(apiKey),
      cache: "no-store"
    }
  );
  const text = await response.text().catch(() => "");
  let payload: Record<string, unknown> = {};
  if (text.trim()) {
    try {
      const parsed = JSON.parse(text) as unknown;
      payload =
        parsed && typeof parsed === "object" && !Array.isArray(parsed)
          ? (parsed as Record<string, unknown>)
          : { response: text };
    } catch {
      payload = { response: text };
    }
  }

  if (!response.ok) {
    const message =
      extractApolloError(payload) ??
      text.trim() ??
      `Apollo request failed with status ${response.status}.`;
    if (response.status === 429 || isApolloRateLimitMessage(message)) {
      throw new ApolloRateLimitError(message);
    }
    throw new Error(message);
  }

  return {
    sequenceIds,
    apolloContactIds: contactIds,
    rawPayload: payload
  };
}

export async function transitionApolloContactsToSequence(
  input: ApolloSequenceTransitionInput
) {
  const transitions = new Map<string, string[]>();
  for (const apolloContactId of input.apolloContactIds) {
    const previousSequenceId =
      input.previousSequenceByContactId[apolloContactId] ?? null;
    if (!previousSequenceId) continue;
    transitions.set(previousSequenceId, [
      ...(transitions.get(previousSequenceId) ?? []),
      apolloContactId
    ]);
  }

  for (const [previousSequenceId, apolloContactIds] of transitions) {
    await removeApolloContactsFromSequences({
      sequenceIds: [previousSequenceId],
      apolloContactIds
    });
  }

  return pushApolloContactsToSequence(input);
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
  const searchBodies = normalizedDomain
    ? [
        {
          page: 1,
          per_page: 10,
          q_organization_domains_list: [normalizedDomain]
        }
      ]
    : buildApolloOrganizationSearchQueries(input.companyName).map((searchCompanyName) => ({
        page: 1,
        per_page: 10,
        q_organization_name: searchCompanyName
      }));
  const scoredCandidates: ApolloOrganizationCandidate[] = [];

  for (const body of searchBodies) {
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

async function findApolloSavedAccountOrganization(
  input: ApolloCompanyLookupInput,
  apiKey: string,
  providedAccountId: string,
  options?: {
    reviewerConfirmed?: boolean;
  }
): Promise<ApolloOrganizationCandidate | null> {
  if (options?.reviewerConfirmed === true) {
    try {
      const exactAccount = await viewApolloSavedAccountOrganization(
        input,
        apiKey,
        providedAccountId,
        options
      );
      if (exactAccount) return exactAccount;
    } catch (error) {
      if (error instanceof ApolloRateLimitError) throw error;
      // Some Apollo plans do not expose Account View. The saved-account
      // directory below is a zero-credit fallback, still constrained to the
      // immutable account ID supplied by the reviewer.
    }
  }

  for (const accountName of buildApolloOrganizationSearchQueries(input.companyName)) {
    const json = await postApolloJson("/api/v1/accounts/search", apiKey, {
      page: 1,
      per_page: 10,
      q_organization_name: accountName
    });
    const exactAccount = parseApolloOrganizations(json).find(
      (candidate) => readApolloString(candidate.rawPayload, ["id"]) === providedAccountId
    );
    if (!exactAccount) {
      continue;
    }

    const trusted = trustExactApolloSavedAccount(
      input,
      exactAccount,
      providedAccountId,
      "saved-account-search",
      options
    );
    if (trusted) return trusted;
  }

  // Account Search is name-dependent and can omit a saved account when the
  // TradeMining legal name differs from Apollo's display name. The confirmed
  // account ID is immutable, so retrieve that exact saved account directly
  // before declaring that Apollo has no employees. Apollo documents this
  // endpoint as zero-credit.
  if (options?.reviewerConfirmed !== true) {
    try {
      return await viewApolloSavedAccountOrganization(
        input,
        apiKey,
        providedAccountId,
        options
      );
    } catch (error) {
      if (error instanceof ApolloRateLimitError) throw error;
      // Older Apollo plans may not expose Account View. Preserve the existing
      // fail-closed result when the exact record cannot be read.
    }
  }

  return null;
}

async function findApolloEquivalentSavedAccountsForOrganization({
  input,
  apiKey,
  providedAccountId,
  providedOrganizationId,
  confirmedSavedAccount
}: {
  input: ApolloCompanyLookupInput;
  apiKey: string;
  providedAccountId: string;
  providedOrganizationId: string;
  confirmedSavedAccount: ApolloOrganizationCandidate | null;
}) {
  const accounts = new Map<
    string,
    {
      accountId: string;
      accountName: string;
      organization: ApolloOrganizationCandidate;
    }
  >();
  const confirmedAccountName = readApolloString(
    confirmedSavedAccount?.rawPayload ?? {},
    ["name", "company_name", "organization_name"]
  );
  const searchQueries = buildApolloEquivalentAccountSearchQueries([
    input.companyName,
    confirmedAccountName,
    confirmedSavedAccount?.name
  ]);

  for (const accountName of searchQueries) {
    const json = await postApolloJson("/api/v1/accounts/search", apiKey, {
      page: 1,
      per_page: 25,
      q_organization_name: accountName
    });

    for (const candidate of parseApolloOrganizations(json)) {
      const accountId = readApolloString(candidate.rawPayload, ["id"]);
      const nestedOrganization = asRecord(
        candidate.rawPayload.organization
      );
      const nestedOrganizationId = readApolloString(
        nestedOrganization ?? {},
        ["id", "organization_id", "apollo_organization_id"]
      );
      const savedAccountName = readApolloString(candidate.rawPayload, [
        "name",
        "company_name",
        "organization_name"
      ]);

      if (
        !accountId ||
        accountId === providedAccountId ||
        !savedAccountName ||
        nestedOrganizationId !== providedOrganizationId ||
        accounts.has(accountId)
      ) {
        continue;
      }

      accounts.set(accountId, {
        accountId,
        accountName: savedAccountName,
        organization: scoreApolloOrganizationCandidate(
          candidate,
          input.companyName,
          normalizeDomain(input.domain),
          {
            source: "same-global-organization-saved-account",
            account_id: accountId,
            organization_id: providedOrganizationId
          }
        )
      });

      if (accounts.size >= APOLLO_EQUIVALENT_ACCOUNT_LIMIT) {
        break;
      }
    }

    if (accounts.size >= APOLLO_EQUIVALENT_ACCOUNT_LIMIT) {
      break;
    }
  }

  return [...accounts.values()];
}

async function viewApolloSavedAccountOrganization(
  input: ApolloCompanyLookupInput,
  apiKey: string,
  accountId: string,
  options?: {
    reviewerConfirmed?: boolean;
  }
) {
  const json = await getApolloJson(
    `/api/v1/accounts/${encodeURIComponent(accountId)}`,
    apiKey
  );
  const account =
    asRecord(json.account) ??
    asRecord(json.data) ??
    asRecord(json.company) ??
    null;
  const exactAccount = account
    ? parseApolloOrganizations({ accounts: [account] }).find(
        (candidate) =>
          readApolloString(candidate.rawPayload, ["id"]) === accountId
      ) ?? null
    : null;

  return exactAccount
    ? trustExactApolloSavedAccount(
        input,
        exactAccount,
        accountId,
        "saved-account-view",
        options
      )
    : null;
}

function trustExactApolloSavedAccount(
  input: ApolloCompanyLookupInput,
  exactAccount: {
    id: string | null;
    name: string | null;
    domain: string | null;
    linkedinUrl: string | null;
    rawPayload: Record<string, unknown>;
  },
  providedAccountId: string,
  source: "saved-account-search" | "saved-account-view",
  options?: {
    reviewerConfirmed?: boolean;
  }
) {
  const inputAliases = buildCompanyNameAliases(input.companyName);
  const accountNameFromApollo = readApolloString(exactAccount.rawPayload, [
    "name",
    "company_name",
    "organization_name"
  ]);
  const accountAliases = buildCompanyNameAliases(accountNameFromApollo ?? "");
  const safeAccountIdentity =
    options?.reviewerConfirmed === true ||
    hasExactAliasMatch(inputAliases, accountAliases) ||
    hasStrongBaseNameMatch(inputAliases, accountAliases) ||
    hasSafeRegionalBrandAlias(inputAliases, accountAliases);
  if (!safeAccountIdentity) {
    return null;
  }

  const scored = scoreApolloOrganizationCandidate(
    exactAccount,
    input.companyName,
    normalizeDomain(input.domain),
    {
      source,
      account_id: providedAccountId
    }
  );
  return {
    ...scored,
    score: Math.max(scored.score, 12),
    strongBaseNameMatch: true,
    classification: ApolloCompanyMatchClassification.DIRECT_COMPANY,
    matchReason:
      `direct company; ${options?.reviewerConfirmed ? "reviewer-confirmed " : ""}exact saved Apollo account mapping; ` +
      `resolved through Apollo's zero-credit saved-account directory`
  };
}

async function searchApolloContacts({
  apiKey,
  companyName,
  domain,
  organizationId,
  queryKeywords,
  enforceExpectedOrganization,
  contactRecovery
}: {
  apiKey: string;
  companyName: string;
  domain?: string | null;
  organizationId: string | null;
  queryKeywords?: string | null;
  enforceExpectedOrganization: boolean;
  contactRecovery?: ApolloContactLookupResult["contactRecovery"];
}) {
  const normalizedDomain = normalizeDomain(domain);
  const contacts: ApolloContactRecord[] = [];
  for (let page = 1; page <= APOLLO_SAVED_CONTACT_MAX_PAGES; page += 1) {
    const json = await postApolloJson("/api/v1/contacts/search", apiKey, {
      page,
      per_page: DEFAULT_PAGE_SIZE,
      q_keywords:
        buildApolloPeopleSearchKeywords(companyName, queryKeywords, false) ||
        companyName
    });
    if (contactRecovery) {
      contactRecovery.savedContactPagesRead += 1;
    }
    const pageContacts = parseApolloContacts(json, "SAVED_CONTACT")
      .map((contact) =>
        attachExpectedApolloOrganization(contact, {
          companyName,
          normalizedDomain,
          organizationId
        })
      );
    const filtered = enforceExpectedOrganization
      ? filterApolloContactsForExpectedOrganization(pageContacts, {
          companyName,
          normalizedDomain,
          organizationId
        })
      : pageContacts;
    contacts.push(...filtered);
    if (pageContacts.length < DEFAULT_PAGE_SIZE) {
      break;
    }
  }
  return contacts.length > 0 ? contacts : null;
}

function filterApolloSavedContactsForConfirmedMapping(
  contacts: ApolloContactRecord[],
  {
    companyNames,
    normalizedDomain,
    organizationIds
  }: {
    companyNames: string[];
    normalizedDomain: string | null;
    organizationIds: Array<string | null | undefined>;
  }
) {
  const trustedOrganizationIds = new Set(
    organizationIds.filter((value): value is string => Boolean(value))
  );

  return contacts.filter((contact) => {
    const organization = readApolloOrganizationFromContact(contact);
    if (!organization) {
      return false;
    }

    if (
      organization.id &&
      trustedOrganizationIds.has(organization.id)
    ) {
      return true;
    }

    if (organization.id) {
      return false;
    }

    if (
      normalizedDomain &&
      organization.domain === normalizedDomain
    ) {
      return true;
    }

    return companyNames.some((companyName) =>
      hasStrictApolloOrganizationIdentityMatch({
        companyName,
        candidateName: organization.name,
        normalizedDomain,
        candidateDomain: organization.domain
      })
    );
  });
}

async function searchApolloPeople({
  apiKey,
  companyName,
  domain,
  organizationId,
  queryKeywords,
  personTitles
}: {
  apiKey: string;
  companyName: string;
  domain?: string | null;
  organizationId: string | null;
  queryKeywords?: string | null;
  personTitles?: readonly string[];
}) {
  const normalizedDomain = normalizeDomain(domain);
  const contacts: ApolloContactRecord[] = [];
  const baseBody = {
    organization_ids: organizationId ? [organizationId] : undefined,
    q_organization_domains_list: normalizedDomain ? [normalizedDomain] : undefined,
    q_keywords: buildApolloPeopleSearchKeywords(
      companyName,
      queryKeywords,
      Boolean(organizationId || normalizedDomain)
    ),
    person_titles: personTitles && personTitles.length > 0 ? [...personTitles] : undefined,
    include_similar_titles: personTitles && personTitles.length > 0 ? true : undefined
  };

  // Apollo documents People Search as a paged, zero-credit endpoint. Read a
  // bounded complete roster instead of silently treating the first 100 people
  // as the whole company. The title-scoped second pass remains separate.
  for (let page = 1; page <= 5; page += 1) {
    const body = {
      ...baseBody,
      page,
      per_page: DEFAULT_PAGE_SIZE
    };
    const json = await postApolloJson(
      buildApolloPeopleSearchPath(body),
      apiKey,
      body
    );
    const pageContacts = parseApolloContacts(json, "PEOPLE_SEARCH");
    contacts.push(...pageContacts);
    if (pageContacts.length < DEFAULT_PAGE_SIZE) {
      break;
    }
  }

  return dedupeApolloContacts(contacts);
}

function buildApolloPeopleSearchPath({
  page,
  per_page: perPage,
  organization_ids: organizationIds,
  q_organization_domains_list: organizationDomains,
  q_keywords: queryKeywords,
  person_titles: personTitles,
  include_similar_titles: includeSimilarTitles
}: {
  page: number;
  per_page: number;
  organization_ids?: string[];
  q_organization_domains_list?: string[];
  q_keywords?: string;
  person_titles?: string[];
  include_similar_titles?: boolean;
}) {
  const params = new URLSearchParams({
    page: String(page),
    per_page: String(perPage)
  });

  for (const organizationId of organizationIds ?? []) {
    params.append("organization_ids[]", organizationId);
  }
  for (const organizationDomain of organizationDomains ?? []) {
    params.append("q_organization_domains_list[]", organizationDomain);
  }
  for (const personTitle of personTitles ?? []) {
    params.append("person_titles[]", personTitle);
  }
  if (queryKeywords) {
    params.set("q_keywords", queryKeywords);
  }
  if (includeSimilarTitles !== undefined) {
    params.set("include_similar_titles", String(includeSimilarTitles));
  }

  return `/api/v1/mixed_people/api_search?${params.toString()}`;
}

async function searchApolloRelevantPeople({
  apiKey,
  companyName,
  domain,
  expectedOrganizationDomain,
  organizationId,
  allowPeopleSearchFallback,
  keywordSearchLimit,
  enforceExpectedOrganization,
  trustExactOrganizationScope = false,
  savedContacts,
  contactRecovery
}: {
  apiKey: string;
  companyName: string;
  domain?: string | null;
  expectedOrganizationDomain?: string | null;
  organizationId: string | null;
  allowPeopleSearchFallback: boolean;
  keywordSearchLimit: number;
  enforceExpectedOrganization: boolean;
  trustExactOrganizationScope?: boolean;
  savedContacts: ApolloContactRecord[] | null;
  contactRecovery: ApolloContactLookupResult["contactRecovery"];
}) {
  const collected: ApolloContactRecord[] = [];
  const normalizedExpectedDomain = normalizeDomain(expectedOrganizationDomain ?? domain);

  const contactsWithoutKeyword = savedContacts !== null
    ? savedContacts
    : ((await searchApolloContacts({
        apiKey,
        companyName,
        domain,
        organizationId,
        queryKeywords: null,
        enforceExpectedOrganization,
        contactRecovery
      })) ?? []);
  collected.push(...contactsWithoutKeyword);

  if (!allowPeopleSearchFallback) {
    return dedupeApolloContacts(collected);
  }

  const peopleWithoutKeywordRaw = await searchApolloPeople({
      apiKey,
      companyName,
      domain,
      organizationId,
      queryKeywords: null
    });
  contactRecovery.peopleSearchRawRecords +=
    peopleWithoutKeywordRaw.length;
  const peopleWithoutKeyword = enforceExpectedOrganization
    ? filterApolloContactsForExpectedOrganization(peopleWithoutKeywordRaw, {
        companyName,
        normalizedDomain: normalizedExpectedDomain,
        organizationId,
        trustExactOrganizationScope
      })
    : peopleWithoutKeywordRaw;
  contactRecovery.peopleSearchAcceptedRecords +=
    peopleWithoutKeyword.length;
  collected.push(...peopleWithoutKeyword);

  const roleTitles = [...APOLLO_PRIMARY_ROLE_KEYWORDS, ...APOLLO_FALLBACK_ROLE_KEYWORDS].slice(
    0,
    Math.max(0, keywordSearchLimit)
  );

  if (roleTitles.length > 0) {
    const rolePeopleRaw = await searchApolloPeople({
        apiKey,
        companyName,
        domain,
        organizationId,
        queryKeywords: null,
        personTitles: roleTitles
      });
    contactRecovery.peopleSearchRawRecords += rolePeopleRaw.length;
    const rolePeople = enforceExpectedOrganization
      ? filterApolloContactsForExpectedOrganization(rolePeopleRaw, {
          companyName,
          normalizedDomain: normalizedExpectedDomain,
          organizationId,
          trustExactOrganizationScope
        })
      : rolePeopleRaw;
    contactRecovery.peopleSearchAcceptedRecords += rolePeople.length;
    collected.push(...rolePeople);
  }

  const ranked = rankApolloRelevantContacts(collected);
  return ranked.length > 0 ? ranked : dedupeApolloContacts(collected);
}

async function recoverConcreteApolloEmails({
  apiKey,
  contacts,
  companyName,
  domain,
  organizationId,
  enforceExpectedOrganization,
  authorizePaidEmailEnrichment,
  contactRecovery
}: {
  apiKey: string;
  contacts: ApolloContactRecord[];
  companyName: string;
  domain: string | null;
  organizationId: string | null;
  enforceExpectedOrganization: boolean;
  authorizePaidEmailEnrichment: boolean;
  contactRecovery: ApolloContactLookupResult["contactRecovery"];
}) {
  let recovered = dedupeApolloContacts(contacts);
  const maskedPeople = rankApolloRelevantContacts(recovered)
    .filter((contact) => !hasConcreteApolloEmail(contact) && contact.hasEmailAvailable)
    .slice(0, APOLLO_SAVED_CONTACT_RECOVERY_LIMIT);

  for (const person of maskedPeople) {
    contactRecovery.maskedPeopleChecked += 1;
    const queryKeywords = [
      person.firstName ?? person.fullName,
      person.title
    ].filter(Boolean).join(" ");
    const savedMatches =
      (await searchApolloContacts({
        apiKey,
        companyName,
        domain,
        organizationId,
        queryKeywords,
        enforceExpectedOrganization,
        contactRecovery
      })) ?? [];
    const concreteSavedMatches = savedMatches.filter(hasConcreteApolloEmail);
    if (concreteSavedMatches.length > 0) {
      contactRecovery.savedContactsRecovered += concreteSavedMatches.length;
      recovered = dedupeApolloContacts([...recovered, ...concreteSavedMatches]);
    }
  }

  if (!authorizePaidEmailEnrichment) {
    return recovered;
  }

  const stillMasked = rankApolloRelevantContacts(recovered)
    .filter(
      (contact) =>
        !hasConcreteApolloEmail(contact) &&
        Boolean(contact.apolloPersonId)
    )
    .slice(0, APOLLO_PAID_EMAIL_ENRICHMENT_LIMIT);
  if (stillMasked.length === 0) {
    return recovered;
  }

  const enrichmentApiKey = readApolloMasterApiKey();
  for (const person of stillMasked) {
    contactRecovery.paidEmailEnrichmentsAttempted += 1;
    const enriched = await enrichApolloPersonEmail({
      apiKey: enrichmentApiKey,
      person,
      companyName,
      domain,
      organizationId
    });
    if (enriched && hasConcreteApolloEmail(enriched)) {
      contactRecovery.paidEmailsRecovered += 1;
      recovered = dedupeApolloContacts([...recovered, enriched]);
    }
  }

  return recovered;
}

async function enrichApolloPersonEmail({
  apiKey,
  person,
  companyName,
  domain,
  organizationId
}: {
  apiKey: string;
  person: ApolloContactRecord;
  companyName: string;
  domain: string | null;
  organizationId: string | null;
}) {
  const params = new URLSearchParams({
    id: person.apolloPersonId ?? "",
    organization_name: companyName,
    reveal_personal_emails: "false",
    reveal_phone_number: "false",
    run_waterfall_email: "false",
    run_waterfall_phone: "false"
  });
  if (domain) {
    params.set("domain", domain);
  }
  const json = await postApolloJson(
    `/api/v1/people/match?${params.toString()}`,
    apiKey,
    {}
  );
  const record =
    asRecord(json.person) ??
    asRecord(json.contact) ??
    asRecord(json.data);
  if (!record) {
    return null;
  }
  const [parsed] = parseApolloContacts({ people: [record] }, "PEOPLE_SEARCH");
  return parsed
    ? attachExpectedApolloOrganization(parsed, {
        companyName,
        normalizedDomain: normalizeDomain(domain),
        organizationId
      })
    : null;
}

async function enrichExplicitApolloPeople({
  personIds,
  companyName,
  trustedDomain,
  contactRecovery
}: {
  personIds: string[];
  companyName: string;
  trustedDomain: string | null;
  contactRecovery: ApolloContactLookupResult["contactRecovery"];
}) {
  const enrichmentApiKey = readApolloMasterApiKey();
  const recovered: ApolloContactRecord[] = [];

  for (const personId of personIds.slice(0, APOLLO_PAID_EMAIL_ENRICHMENT_LIMIT)) {
    // Apollo's /people/<id> UI route can contain either a global person ID or
    // an already-saved workspace contact ID. Resolve the zero-credit saved
    // contact shape first so a valid pasted URL is not incorrectly sent only
    // to People Enrichment and reported as "0 contacts found."
    const savedContact = await fetchExplicitApolloSavedContact({
      apiKey: enrichmentApiKey,
      contactId: personId,
      companyName,
      trustedDomain
    });
    if (savedContact) {
      contactRecovery.savedContactsRecovered += 1;
      recovered.push(savedContact);
      continue;
    }

    contactRecovery.paidEmailEnrichmentsAttempted += 1;
    const enriched = await enrichApolloPersonEmail({
      apiKey: enrichmentApiKey,
      person: {
        recordSource: "PEOPLE_SEARCH",
        apolloContactId: null,
        apolloPersonId: personId,
        firstName: null,
        lastName: null,
        lastNameObfuscated: null,
        fullName: personId,
        title: null,
        department: null,
        seniority: null,
        email: null,
        phone: null,
        linkedinUrl: null,
        hasEmailAvailable: false,
        hasPhoneAvailable: false,
        hasLinkedinAvailable: false,
        city: null,
        state: null,
        country: null,
        sequenceStatus: SequenceStatus.NOT_STARTED,
        replyStatus: ReplyStatus.NO_REPLY,
        sequenceId: null,
        sequenceName: null,
        sequenceOwnerName: null,
        sequenceOwnerUserId: null,
        lastTouchAt: null,
        lastReplyAt: null,
        rawPayload: {}
      },
      companyName,
      domain: trustedDomain,
      organizationId: null
    });
    if (
      !enriched ||
      !hasConcreteApolloEmail(enriched) ||
      !isExplicitApolloPersonCompanyMatch({
        contact: enriched,
        companyName,
        trustedDomain
      })
    ) {
      continue;
    }

    contactRecovery.paidEmailsRecovered += 1;
    recovered.push(enriched);
  }

  return dedupeApolloContacts(recovered);
}

async function fetchExplicitApolloSavedContact({
  apiKey,
  contactId,
  companyName,
  trustedDomain
}: {
  apiKey: string;
  contactId: string;
  companyName: string;
  trustedDomain: string | null;
}) {
  try {
    const json = await getApolloJson(
      `/api/v1/contacts/${encodeURIComponent(contactId)}`,
      apiKey
    );
    const record =
      asRecord(json.contact) ??
      asRecord(json.data) ??
      json;
    const [contact] = parseApolloContacts(
      { contacts: [record] },
      "SAVED_CONTACT"
    );
    if (
      !contact ||
      !hasConcreteApolloEmail(contact) ||
      !isExplicitApolloPersonCompanyMatch({
        contact,
        companyName,
        trustedDomain
      })
    ) {
      return null;
    }
    return contact;
  } catch (error) {
    if (error instanceof ApolloRateLimitError) {
      throw error;
    }
    // A global person ID is expected to miss Contact View. Continue to the
    // separately authorized People Enrichment request for that identifier.
    return null;
  }
}

function isExplicitApolloPersonCompanyMatch({
  contact,
  companyName,
  trustedDomain
}: {
  contact: ApolloContactRecord;
  companyName: string;
  trustedDomain: string | null;
}) {
  const organization = readApolloOrganizationFromContact(contact);
  if (!organization?.name) {
    return false;
  }

  return filterTrustedApolloAccountNameFallback({
    contacts: [contact],
    companyName,
    trustedDomain
  }).length === 1;
}

function hasConcreteApolloEmail(contact: ApolloContactRecord) {
  const email = contact.email?.trim() ?? "";
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function attachExpectedApolloOrganization(
  contact: ApolloContactRecord,
  {
    companyName,
    normalizedDomain,
    organizationId
  }: {
    companyName: string;
    normalizedDomain: string | null;
    organizationId: string | null;
  }
) {
  if (readApolloOrganizationFromContact(contact)) {
    return contact;
  }
  return {
    ...contact,
    rawPayload: {
      ...contact.rawPayload,
      organization: {
        id: organizationId,
        name: companyName,
        primary_domain: normalizedDomain
      }
    }
  };
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
    const message = extractApolloError(json) ?? `Apollo request failed with status ${response.status}.`;
    if (response.status === 429 || isApolloRateLimitMessage(message)) {
      throw new ApolloRateLimitError(message);
    }
    throw new Error(message);
  }

  if (!json) {
    throw new Error("Apollo returned an unreadable response body.");
  }

  return json;
}

async function getApolloJson(path: string, apiKey: string) {
  const response = await fetch(`${DEFAULT_BASE_URL}${path}`, {
    method: "GET",
    headers: buildApolloHeaders(apiKey),
    cache: "no-store"
  });
  const json = (await response.json().catch(() => null)) as Record<string, unknown> | null;

  if (!response.ok) {
    const message = extractApolloError(json) ?? `Apollo request failed with status ${response.status}.`;
    if (response.status === 429 || isApolloRateLimitMessage(message)) {
      throw new ApolloRateLimitError(message);
    }
    throw new Error(message);
  }

  if (!json) {
    throw new Error("Apollo returned an unreadable response body.");
  }

  return json;
}

async function patchApolloJson(path: string, apiKey: string, body: Record<string, unknown>) {
  const response = await fetch(`${DEFAULT_BASE_URL}${path}`, {
    method: "PATCH",
    headers: buildApolloHeaders(apiKey),
    cache: "no-store",
    body: JSON.stringify(body)
  });
  const json = (await response.json().catch(() => null)) as Record<string, unknown> | null;

  if (!response.ok) {
    const message = extractApolloError(json) ?? `Apollo request failed with status ${response.status}.`;
    if (response.status === 429 || isApolloRateLimitMessage(message)) {
      throw new ApolloRateLimitError(message);
    }
    throw new Error(message);
  }

  return json ?? {};
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

function parseApolloTypedCustomFieldsResponse(payload: ApolloTypedCustomFieldsResponse | null): ApolloTypedCustomFieldEntry[] {
  const candidates = Array.isArray(payload?.typed_custom_fields)
    ? payload?.typed_custom_fields
    : Array.isArray(payload?.custom_fields)
      ? payload?.custom_fields
      : Array.isArray(payload?.data)
        ? payload?.data
        : [];

  return candidates.flatMap((entry) => {
    const record = asRecord(entry);
    if (!record) {
      return [];
    }

    const id = readApolloString(record, ["id", "typed_custom_field_id", "custom_field_id"]);
    const names = [
      readApolloString(record, ["name"]),
      readApolloString(record, ["label"]),
      readApolloString(record, ["api_name"]),
      readApolloString(record, ["slug"]),
      readApolloString(record, ["key"])
    ].filter((value): value is string => Boolean(value));

    if (!id || names.length === 0) {
      return [];
    }

    return [
      {
        id,
        name: names[0],
        aliases: [...new Set(names.map((value) => normalizeApolloCustomFieldKey(value)).filter(Boolean))]
      }
    ];
  });
}

function findApolloTypedCustomField(directory: ApolloTypedCustomFieldEntry[], fieldName: string) {
  const normalizedTarget = normalizeApolloCustomFieldKey(fieldName);

  return (
    directory.find((entry) => entry.aliases.includes(normalizedTarget)) ??
    directory.find((entry) => entry.aliases.some((alias) => alias.includes(normalizedTarget) || normalizedTarget.includes(alias))) ??
    null
  );
}

function normalizeApolloCustomFieldKey(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
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

    const nestedOrganization = asRecord(record.organization);
    const id =
      readApolloString(record, ["organization_id", "apollo_organization_id"]) ??
      readApolloString(nestedOrganization ?? {}, ["id", "organization_id", "apollo_organization_id"]) ??
      readApolloString(record, ["id"]);
    const name =
      readApolloString(nestedOrganization ?? {}, ["name", "company_name", "organization_name"]) ??
      readApolloString(record, ["name", "company_name", "organization_name"]);
    const domain = normalizeDomain(
      readApolloString(nestedOrganization ?? {}, [
        "primary_domain",
        "website_url",
        "domain",
        "apollo_domain"
      ]) ??
        readApolloString(record, ["primary_domain", "website_url", "domain", "apollo_domain"])
    );
    const linkedinUrl =
      readApolloString(nestedOrganization ?? {}, [
        "linkedin_url",
        "organization_linkedin_url",
        "company_linkedin_url",
        "linkedin",
        "linkedin_profile_url"
      ]) ??
      readApolloString(record, [
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

function parseApolloContacts(
  payload: Record<string, unknown>,
  recordSource: ApolloContactRecord["recordSource"]
): ApolloContactRecord[] {
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
    const lastNameObfuscated = readApolloString(record, ["last_name_obfuscated"]);
    const fullName =
      readApolloString(record, ["full_name", "name"]) ??
      buildName(firstName, lastName ?? lastNameObfuscated);

    if (!fullName) {
      return [];
    }

    const organization = asRecord(record.organization) ?? asRecord(record.account) ?? asRecord(record.company);
    const sequenceDetails =
      asRecord(record.sequence) ??
      asRecord(record.cadence) ??
      asRecord(record.enrollment) ??
      selectCurrentApolloCampaignStatus(record);
    const campaignSequenceStatus = parseSequenceStatus(
      readApolloString(record, [
        "apollo_sequence_status",
        "sequence_status",
        "enrollment_status",
        "emailer_campaign_status"
      ]) ?? readApolloString(sequenceDetails ?? {}, ["status", "state"])
    );
    const deliveryFailure =
      classifyApolloDeliveryFailure(record) ??
      (sequenceDetails ? classifyApolloDeliveryFailure(sequenceDetails) : null);
    const sequenceStatus = deliveryFailure ? SequenceStatus.BOUNCED : campaignSequenceStatus;
    const explicitReplyStatus = parseReplyStatus(
      readApolloString(record, ["reply_status", "response_status", "last_response_type"])
    );
    const replyStatus =
      explicitReplyStatus === ReplyStatus.NO_REPLY && sequenceStatus === SequenceStatus.REPLIED
        ? ReplyStatus.REPLIED
        : explicitReplyStatus;
    const lastReplyAt =
      parseApolloDate(readApolloString(record, ["last_reply_at", "replied_at", "responded_at"])) ??
      (sequenceStatus === SequenceStatus.REPLIED
        ? parseApolloDate(readApolloString(sequenceDetails ?? {}, ["replied_at", "responded_at", "updated_at"]))
        : null);

    const email = readApolloString(record, ["email"]);
    const phone = readApolloString(record, ["phone", "phone_number", "mobile_phone"]);
    const linkedinUrl = readApolloString(record, ["linkedin_url"]);

    return [
      {
        recordSource,
        apolloContactId:
          recordSource === "SAVED_CONTACT"
            ? readApolloString(record, ["contact_id", "apollo_contact_id", "id"])
            : null,
        apolloPersonId:
          recordSource === "PEOPLE_SEARCH"
            ? readApolloString(record, ["person_id", "apollo_person_id", "id"])
            : readApolloString(record, ["person_id", "apollo_person_id"]),
        firstName,
        lastName,
        lastNameObfuscated,
        fullName,
        title: readApolloString(record, ["title", "job_title"]),
        department: readApolloString(record, ["department", "department_name", "function"]),
        seniority: readApolloString(record, ["seniority", "seniority_level"]),
        email,
        phone,
        linkedinUrl,
        hasEmailAvailable:
          Boolean(email) || readApolloBoolean(record, ["has_email"], false),
        hasPhoneAvailable:
          Boolean(phone) ||
          readApolloBoolean(
            record,
            ["has_phone", "has_direct_phone", "has_mobile_phone"],
            false
          ),
        hasLinkedinAvailable:
          Boolean(linkedinUrl) ||
          readApolloBoolean(record, ["has_linkedin", "has_linkedin_url"], false),
        city: readApolloString(record, ["city"]),
        state: readApolloString(record, ["state", "region"]),
        country: readApolloString(record, ["country"]),
        sequenceStatus,
        replyStatus,
        sequenceId:
          readApolloString(record, ["apollo_sequence_id", "sequence_id", "emailer_campaign_id"]) ??
          readApolloString(sequenceDetails ?? {}, ["emailer_campaign_id", "campaign_id", "id"]),
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
        lastReplyAt,
        rawPayload: {
          ...record,
          organization,
          sequence: sequenceDetails,
          ...(deliveryFailure
            ? {
                newlDeliveryFailureReconciliation: {
                  source: "APOLLO_CONTACT_RECORD",
                  kind: deliveryFailure.kind,
                  reason: deliveryFailure.reason,
                  record
                }
              }
            : {})
        }
      }
    ];
  });
}

function selectCurrentApolloCampaignStatus(record: Record<string, unknown>) {
  const candidates = readApolloArray(record, ["contact_campaign_statuses"])
    .map((candidate) => asRecord(candidate))
    .filter((candidate): candidate is Record<string, unknown> => Boolean(candidate));

  return candidates.reduce<Record<string, unknown> | null>((selected, candidate) => {
    if (!selected) {
      return candidate;
    }

    const candidateRank = apolloCampaignStatusRank(readApolloString(candidate, ["status", "state"]));
    const selectedRank = apolloCampaignStatusRank(readApolloString(selected, ["status", "state"]));
    if (candidateRank !== selectedRank) {
      return candidateRank > selectedRank ? candidate : selected;
    }

    const candidateAddedAt = parseApolloDate(readApolloString(candidate, ["added_at", "created_at", "updated_at"]));
    const selectedAddedAt = parseApolloDate(readApolloString(selected, ["added_at", "created_at", "updated_at"]));
    return (candidateAddedAt?.getTime() ?? 0) >= (selectedAddedAt?.getTime() ?? 0) ? candidate : selected;
  }, null);
}

function apolloCampaignStatusRank(value: string | null) {
  const status = parseSequenceStatus(value);

  switch (status) {
    case SequenceStatus.REPLIED:
      return 7;
    case SequenceStatus.BOUNCED:
      return 6;
    case SequenceStatus.ENROLLED:
      return 5;
    case SequenceStatus.PAUSED:
      return 4;
    case SequenceStatus.FINISHED:
      return 3;
    case SequenceStatus.READY:
      return 2;
    case SequenceStatus.NOT_STARTED:
      return 1;
  }
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

  const sorted = scored.sort((left, right) => right.score - left.score);
  const safeMatches = sorted.filter((candidate) =>
    hasStrictApolloOrganizationIdentityMatch({
      companyName,
      candidateName: candidate.name,
      normalizedDomain,
      candidateDomain: candidate.domain
    })
  );
  const safeOrganizationIds = new Set(
    safeMatches.map((candidate) => candidate.id).filter((id): id is string => Boolean(id))
  );
  const best = safeMatches[0] ?? sorted[0] ?? null;
  if (!best) {
    return null;
  }

  const bestAliases = buildCompanyNameAliases(best.name ?? "");
  const exactPeopleBackedNameMatch = hasExactAliasMatch(inputAliases, bestAliases);
  const strongPeopleBackedNameMatch = hasStrongBaseNameMatch(inputAliases, bestAliases);
  const safeIdentityMatch = safeMatches.includes(best);
  const peopleEvidenceCount = candidates.get(
    [best.id ?? "", best.name?.toLowerCase() ?? "", best.domain ?? ""].join("|")
  )?.appearances ?? 0;

  const promotedClassification =
    safeOrganizationIds.size > 1
      ? ApolloCompanyMatchClassification.MATCH_QUALITY_REVIEW
      : safeIdentityMatch && peopleEvidenceCount >= 1
      ? ApolloCompanyMatchClassification.DIRECT_COMPANY
      : downgradeUnsafeInferredDirectMatch(classifyApolloOrganizationCandidate({
          id: best.id,
          score: best.score,
          nameMatchType: best.nameMatchType,
          domainMatch: best.domainMatch,
          logisticsProviderMatch: best.logisticsProviderMatch,
          branchLocationMatch: best.branchLocationMatch,
          strongBaseNameMatch: best.strongBaseNameMatch,
          tokenSimilarity: calculateBestTokenSimilarity(inputAliases, bestAliases)
        }));

  return {
    ...best,
    classification: promotedClassification,
    matchReason:
      safeOrganizationIds.size > 1
        ? `${best.matchReason}; multiple exact Apollo organizations matched the expected company identity`
        : promotedClassification === ApolloCompanyMatchClassification.DIRECT_COMPANY &&
            (exactPeopleBackedNameMatch || strongPeopleBackedNameMatch || best.domainMatch)
          ? `${best.matchReason}; promoted from exact saved-contact/people organization evidence`
          : best.classification === ApolloCompanyMatchClassification.DIRECT_COMPANY
            ? `${best.matchReason}; downgraded because the Apollo organization identity could be a parent or sibling company`
        : best.matchReason
  };
}

function inferTrustedApolloDomainFromContacts(
  contacts: ApolloContactRecord[],
  companyName: string
) {
  const expectedAliases = buildCompanyNameAliases(companyName);
  const domains = new Set<string>();

  for (const contact of contacts) {
    const organization = readApolloOrganizationFromContact(contact);
    if (!organization?.domain || !organization.name) {
      continue;
    }
    const candidateAliases = buildCompanyNameAliases(organization.name);
    if (
      hasExactAliasMatch(expectedAliases, candidateAliases) ||
      hasStrongBaseNameMatch(expectedAliases, candidateAliases) ||
      hasSafeRegionalBrandAlias(expectedAliases, candidateAliases) ||
      hasSafeScopedOrganizationAcronymMatch(expectedAliases, candidateAliases)
    ) {
      domains.add(organization.domain);
    }
  }

  return domains.size === 1 ? [...domains][0] ?? null : null;
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
  return contacts.filter((contact) => {
    const candidateOrganization = readApolloOrganizationFromContact(contact);
    if (!candidateOrganization) {
      return false;
    }

    if (organization.id && candidateOrganization.id !== organization.id) {
      return false;
    }

    return hasStrictApolloOrganizationIdentityMatch({
      companyName,
      candidateName: candidateOrganization.name,
      normalizedDomain: organization.domain,
      candidateDomain: candidateOrganization.domain
    });
  });
}

function filterApolloContactsForExpectedOrganization(
  contacts: ApolloContactRecord[],
  {
    companyName,
    normalizedDomain,
    organizationId,
    trustExactOrganizationScope = false
  }: {
    companyName: string;
    normalizedDomain: string | null;
    organizationId: string | null;
    trustExactOrganizationScope?: boolean;
  }
) {
  const expectedAliases = buildCompanyNameAliases(companyName);

  return contacts.filter((contact) => {
    const organization = readApolloOrganizationFromContact(contact);
    if (!organization) {
      // Apollo may omit organization details from a response that was already
      // scoped by organization_ids/domain. Reject explicit mismatches below.
      return true;
    }

    if (organizationId) {
      if (
        trustExactOrganizationScope &&
        contact.recordSource === "PEOPLE_SEARCH"
      ) {
        // A reviewer-confirmed Apollo account URL is authoritative. Apollo's
        // organization_ids[] query scopes the returned roster to the exact
        // global organization resolved from that URL, but individual people
        // can embed a different saved Account ID and operating-brand label
        // (for example CGT under Canadian General Tower). Those identifiers
        // are different namespaces, not evidence that Apollo returned another
        // employer. Trust the exact query scope instead of discarding the
        // complete roster after Apollo has already applied it.
        return true;
      }

      if (organization.id && organization.id !== organizationId) {
        return false;
      }

      if (organization.id === organizationId) {
        return true;
      }

      if (
        contact.recordSource === "PEOPLE_SEARCH" &&
        !organization.id &&
        !organization.domain &&
        hasSafeScopedLeadingBrandExpansion(
          companyName,
          organization.name
        )
      ) {
        // Apollo sometimes returns only its marketing/brand label on people
        // retrieved through an exact organization_ids[] query. The query scope
        // is the authoritative employer identity in that response; rejecting
        // the record because the embedded label differs would discard valid
        // people such as YAT USA's "YAT - Your Advanced Technology" roster.
        return true;
      }

      if (!organization.name && !organization.domain) {
        return true;
      }

      if (
        contact.recordSource === "PEOPLE_SEARCH" &&
        normalizedDomain &&
        organization.domain === normalizedDomain
      ) {
        return true;
      }

      // People API Search is already constrained by organization_ids, but its
      // response normally omits organization.id. Validate the returned company
      // name/domain when present instead of discarding every scoped employee.
      return (
        hasStrictApolloOrganizationIdentityMatch({
          companyName,
          candidateName: organization.name,
          normalizedDomain,
          candidateDomain: organization.domain
        }) ||
        hasSafeScopedOrganizationAcronymMatch(
          buildCompanyNameAliases(companyName),
          buildCompanyNameAliases(organization.name ?? "")
        )
      );
    }

    if (normalizedDomain) {
      if (
        contact.recordSource === "PEOPLE_SEARCH" &&
        !organization.domain &&
        hasSafeScopedLeadingBrandExpansion(
          companyName,
          organization.name
        )
      ) {
        // The same Apollo response-shape gap occurs on exact
        // q_organization_domains_list[] searches. Trust the documented query
        // scope when the returned person does not contradict it with a domain.
        return true;
      }
      return organization.domain === normalizedDomain;
    }

    const candidateAliases = buildCompanyNameAliases(organization.name ?? "");
    return (
      hasExactAliasMatch(expectedAliases, candidateAliases) ||
      hasStrongBaseNameMatch(expectedAliases, candidateAliases)
    );
  });
}

function filterTrustedApolloAccountNameFallback({
  contacts,
  companyName,
  trustedDomain
}: {
  contacts: ApolloContactRecord[];
  companyName: string;
  trustedDomain: string | null;
}) {
  const expectedAliases = buildCompanyNameAliases(companyName);

  return contacts.filter((contact) => {
    const organization = readApolloOrganizationFromContact(contact);
    if (!organization?.name) {
      return false;
    }

    const candidateAliases = buildCompanyNameAliases(organization.name);
    const exactCompanyName =
      hasExactAliasMatch(expectedAliases, candidateAliases) ||
      hasStrongBaseNameMatch(expectedAliases, candidateAliases) ||
      hasSafeRegionalBrandAlias(expectedAliases, candidateAliases) ||
      hasSafeScopedLeadingBrandExpansion(companyName, organization.name);
    if (!exactCompanyName) {
      return false;
    }

    return (
      !trustedDomain ||
      !organization.domain ||
      organization.domain === trustedDomain
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
  const deduped: ApolloContactRecord[] = [];

  for (const entry of entries) {
    const existingIndex = deduped.findIndex((candidate) =>
      isSameApolloPerson(candidate, entry)
    );
    if (existingIndex < 0) {
      deduped.push(entry);
      continue;
    }

    deduped[existingIndex] = mergeApolloContactRecords(
      deduped[existingIndex]!,
      entry
    );
  }

  return deduped;
}

function dedupeApolloPersonIds(entries: string[]) {
  return [
    ...new Set(
      entries
        .map((entry) => entry.trim().toLowerCase())
        .filter((entry) => /^[a-f0-9]{24}$/u.test(entry))
    )
  ];
}

function isSameApolloPerson(
  left: ApolloContactRecord,
  right: ApolloContactRecord
) {
  if (
    (left.apolloPersonId &&
      right.apolloPersonId &&
      left.apolloPersonId === right.apolloPersonId) ||
    (left.apolloContactId &&
      right.apolloContactId &&
      left.apolloContactId === right.apolloContactId)
  ) {
    return true;
  }

  const leftLinkedin = normalizeApolloIdentityValue(left.linkedinUrl);
  const rightLinkedin = normalizeApolloIdentityValue(right.linkedinUrl);
  if (leftLinkedin && rightLinkedin && leftLinkedin === rightLinkedin) {
    return true;
  }
  const leftEmail = normalizeApolloIdentityValue(left.email);
  const rightEmail = normalizeApolloIdentityValue(right.email);
  if (leftEmail && rightEmail && leftEmail === rightEmail) {
    return true;
  }

  const leftFirstName = normalizeApolloIdentityValue(
    left.firstName ?? left.fullName.split(/\s+/u)[0] ?? null
  );
  const rightFirstName = normalizeApolloIdentityValue(
    right.firstName ?? right.fullName.split(/\s+/u)[0] ?? null
  );
  const leftTitle = normalizeApolloIdentityValue(left.title);
  const rightTitle = normalizeApolloIdentityValue(right.title);
  return Boolean(
    leftFirstName &&
    rightFirstName &&
    leftFirstName === rightFirstName &&
    leftTitle &&
    rightTitle &&
    leftTitle === rightTitle &&
    haveStrictApolloContactCompanyIdentity(left, right)
  );
}

function haveStrictApolloContactCompanyIdentity(
  left: ApolloContactRecord,
  right: ApolloContactRecord
) {
  const leftOrganization = readApolloOrganizationFromContact(left);
  const rightOrganization = readApolloOrganizationFromContact(right);
  if (!leftOrganization || !rightOrganization) {
    return false;
  }
  if (leftOrganization.id && rightOrganization.id) {
    return leftOrganization.id === rightOrganization.id;
  }
  if (leftOrganization.domain && rightOrganization.domain) {
    return leftOrganization.domain === rightOrganization.domain;
  }
  if (!leftOrganization.name || !rightOrganization.name) {
    return false;
  }
  const leftAliases = buildCompanyNameAliases(leftOrganization.name);
  const rightAliases = buildCompanyNameAliases(rightOrganization.name);
  return (
    hasExactAliasMatch(leftAliases, rightAliases) ||
    hasStrongBaseNameMatch(leftAliases, rightAliases) ||
    hasSafeRegionalBrandAlias(leftAliases, rightAliases)
  );
}

function normalizeApolloIdentityValue(value: string | null | undefined) {
  return value?.trim().toLowerCase() || null;
}

function mergeApolloContactRecords(
  left: ApolloContactRecord,
  right: ApolloContactRecord
): ApolloContactRecord {
  const preferred =
    left.recordSource === "SAVED_CONTACT" && right.recordSource !== "SAVED_CONTACT"
      ? left
      : right.recordSource === "SAVED_CONTACT" && left.recordSource !== "SAVED_CONTACT"
        ? right
        : scoreApolloContactEntry(right) > scoreApolloContactEntry(left)
          ? right
          : left;
  const fallback = preferred === left ? right : left;

  return {
    ...fallback,
    ...preferred,
    apolloContactId: preferred.apolloContactId ?? fallback.apolloContactId,
    apolloPersonId: preferred.apolloPersonId ?? fallback.apolloPersonId,
    firstName: preferred.firstName ?? fallback.firstName,
    lastName: preferred.lastName ?? fallback.lastName,
    lastNameObfuscated:
      preferred.lastNameObfuscated ?? fallback.lastNameObfuscated,
    title: preferred.title ?? fallback.title,
    department: preferred.department ?? fallback.department,
    seniority: preferred.seniority ?? fallback.seniority,
    email: preferred.email ?? fallback.email,
    phone: preferred.phone ?? fallback.phone,
    linkedinUrl: preferred.linkedinUrl ?? fallback.linkedinUrl,
    city: preferred.city ?? fallback.city,
    state: preferred.state ?? fallback.state,
    country: preferred.country ?? fallback.country,
    hasEmailAvailable:
      preferred.hasEmailAvailable || fallback.hasEmailAvailable,
    hasPhoneAvailable:
      preferred.hasPhoneAvailable || fallback.hasPhoneAvailable,
    hasLinkedinAvailable:
      preferred.hasLinkedinAvailable || fallback.hasLinkedinAvailable,
    rawPayload: {
      ...fallback.rawPayload,
      ...preferred.rawPayload,
      organization:
        preferred.rawPayload.organization ?? fallback.rawPayload.organization,
      apolloSources: [...new Set([left.recordSource, right.recordSource])]
    }
  };
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
  const accountRecordName = readApolloString(candidate.rawPayload, [
    "name",
    "company_name",
    "organization_name"
  ]);
  const accountAliases = buildCompanyNameAliases(accountRecordName ?? "");
  const nestedOrganization = asRecord(candidate.rawPayload.organization);
  const nestedOrganizationId = readApolloString(nestedOrganization ?? {}, [
    "id",
    "organization_id",
    "apollo_organization_id"
  ]);
  const tokenSimilarity = calculateBestTokenSimilarity(inputAliases, candidateAliases);
  const logisticsProviderMatch = isLogisticsProviderName(candidate.name ?? "") || isLogisticsProviderName(companyName);
  const accountBackedCanonicalMatch = Boolean(
    nestedOrganizationId &&
    candidate.id === nestedOrganizationId &&
    accountAliases.length > 0 &&
    hasStrongBaseNameMatch(inputAliases, accountAliases)
  );
  const strongBaseNameMatch =
    hasStrongBaseNameMatch(inputAliases, candidateAliases) ||
    hasSafeRegionalBrandAlias(inputAliases, candidateAliases) ||
    accountBackedCanonicalMatch;
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

function buildTrustedProvidedApolloOrganization(
  input: ApolloCompanyLookupInput,
  organizationId: string
): ApolloOrganizationCandidate {
  const domain = normalizeDomain(input.domain);
  return {
    id: organizationId,
    name: input.companyName,
    domain,
    linkedinUrl: null,
    score: 100,
    nameMatchType: "EXACT",
    domainMatch: Boolean(domain),
    logisticsProviderMatch: false,
    branchLocationMatch: false,
    strongBaseNameMatch: true,
    classification: ApolloCompanyMatchClassification.DIRECT_COMPANY,
    matchReason: "direct company; manually confirmed Apollo organization mapping",
    query: {
      source: "confirmed-apollo-organization-id",
      organization_ids: [organizationId]
    },
    rawPayload: {
      source: "confirmed-apollo-organization-id",
      organization_id: organizationId
    }
  };
}

function isDirectApolloCompanyMatch(candidate: ApolloOrganizationCandidate | null) {
  if (!candidate?.id) {
    return false;
  }

  return candidate.classification === ApolloCompanyMatchClassification.DIRECT_COMPANY;
}

function isSafeCanonicalApolloOrganizationResolution(
  candidate: ApolloOrganizationCandidate,
  input: ApolloCompanyLookupInput
) {
  if (!isDirectApolloCompanyMatch(candidate)) {
    return false;
  }

  const inputAliases = buildCompanyNameAliases(input.companyName);
  const candidateAliases = buildCompanyNameAliases(candidate.name ?? "");
  const normalizedDomain = normalizeDomain(input.domain);
  const nestedOrganization = asRecord(candidate.rawPayload.organization);
  const nestedOrganizationId = readApolloString(nestedOrganization ?? {}, [
    "id",
    "organization_id",
    "apollo_organization_id"
  ]);
  const accountName = readApolloString(candidate.rawPayload, [
    "name",
    "company_name",
    "organization_name"
  ]);
  const accountAliases = buildCompanyNameAliases(accountName ?? "");
  const accountBackedCanonicalMatch = Boolean(
    nestedOrganizationId &&
    candidate.id === nestedOrganizationId &&
    accountAliases.length > 0 &&
    hasStrongBaseNameMatch(inputAliases, accountAliases)
  );

  return (
    Boolean(normalizedDomain && candidate.domain === normalizedDomain) ||
    hasExactAliasMatch(inputAliases, candidateAliases) ||
    hasSafeRegionalBrandAlias(inputAliases, candidateAliases) ||
    accountBackedCanonicalMatch
  );
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
  if (hasConcreteApolloEmail(entry)) score += 12;
  if (entry.hasEmailAvailable) score += 4;
  if (entry.title) score += 2;
  if (entry.hasLinkedinAvailable) score += 2;
  if (entry.sequenceStatus !== SequenceStatus.NOT_STARTED) score += 1;
  return score;
}

function buildApolloPeopleSearchKeywords(companyName: string, queryKeywords: string | null | undefined, constrainedToOrganization: boolean) {
  const trimmedKeyword = queryKeywords?.trim() ?? "";

  if (!trimmedKeyword) {
    return constrainedToOrganization
      ? undefined
      : boundApolloKeywordText(companyName);
  }

  return boundApolloKeywordText(
    constrainedToOrganization
      ? trimmedKeyword
      : `${companyName} ${trimmedKeyword}`
  );
}

function boundApolloKeywordText(value: string) {
  return value
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, APOLLO_KEYWORD_MAX_LENGTH)
    .trim();
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

  if (
    /(operations|supply chain|logistics|procurement|purchasing|distribution|shipping|receiving)/.test(
      roleText
    )
  ) {
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

function isApolloRateLimitMessage(message: string) {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("maximum number of api calls allowed") ||
    normalized.includes("rate limit") ||
    normalized.includes("too many requests")
  );
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
  const occurredAt = readApolloString(record, ["start_time", "started_at", "end_time", "created_at", "completed_at", "updated_at"]);

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
  const occurredAt = readApolloString(record, ["start_time", "started_at", "created_at", "occurred_at", "updated_at"]);

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

export function normalizeCompanyName(value: string) {
  return value
    .toLowerCase()
    .replace(/\b(incorporated|inc|llc|ltd|limited|corp|corporation|co|company|sa|s\.a|plc|gmbh)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
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

  return queries.slice(0, 2);
}

function buildApolloEquivalentAccountSearchQueries(
  values: Array<string | null | undefined>
) {
  const queries = new Set<string>();

  for (const value of values) {
    if (!value?.trim()) {
      continue;
    }

    for (const query of buildApolloOrganizationSearchQueries(value)) {
      queries.add(query);
    }

    const acronym = buildApolloCompanyAcronym(value);
    if (acronym) {
      queries.add(acronym);
    }
  }

  return [...queries].slice(
    0,
    APOLLO_EQUIVALENT_ACCOUNT_QUERY_LIMIT
  );
}

function buildApolloCompanyAcronym(value: string) {
  const tokens = tokenizeCompanyName(value).filter(
    (token) => !APOLLO_REGIONAL_IDENTITY_TOKENS.has(token)
  );
  if (tokens.length < 2) {
    return null;
  }

  const acronym = tokens.map((token) => token[0]).join("").toUpperCase();
  return acronym.length >= 2 && acronym.length <= 8
    ? acronym
    : null;
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

function hasStrictApolloOrganizationIdentityMatch({
  companyName,
  candidateName,
  normalizedDomain,
  candidateDomain
}: {
  companyName: string;
  candidateName: string | null;
  normalizedDomain: string | null;
  candidateDomain: string | null;
}) {
  const expectedIdentity = normalizeStrictApolloOrganizationName(companyName);
  const candidateIdentity = normalizeStrictApolloOrganizationName(candidateName ?? "");
  if (expectedIdentity && candidateIdentity && expectedIdentity === candidateIdentity) {
    return true;
  }

  if (!normalizedDomain || candidateDomain !== normalizedDomain || !candidateName) {
    return false;
  }

  const expectedAliases = buildCompanyNameAliases(companyName);
  const candidateAliases = buildCompanyNameAliases(candidateName);
  return (
    hasExactAliasMatch(expectedAliases, candidateAliases) ||
    hasSafeRegionalBrandAlias(expectedAliases, candidateAliases) ||
    hasSafeScopedOrganizationAcronymMatch(expectedAliases, candidateAliases)
  );
}

function hasSafeRegionalBrandAlias(
  expectedAliases: string[],
  candidateAliases: string[]
) {
  return expectedAliases.some((expectedAlias) =>
    candidateAliases.some((candidateAlias) => {
      const expectedTokens = tokenizeCompanyName(expectedAlias);
      const candidateTokens = tokenizeCompanyName(candidateAlias);
      const shorter =
        expectedTokens.length <= candidateTokens.length
          ? expectedTokens
          : candidateTokens;
      const longer =
        expectedTokens.length <= candidateTokens.length
          ? candidateTokens
          : expectedTokens;

      if (
        shorter.length === 0 ||
        shorter[0]!.length < 4 ||
        shorter.length >= longer.length
      ) {
        return false;
      }

      return (
        shorter.every((token, index) => token === longer[index]) &&
        longer
          .slice(shorter.length)
          .every((token) => APOLLO_REGIONAL_IDENTITY_TOKENS.has(token))
      );
    })
  );
}

function hasSafeScopedOrganizationAcronymMatch(
  expectedAliases: string[],
  candidateAliases: string[]
) {
  return expectedAliases.some((expectedAlias) =>
    candidateAliases.some((candidateAlias) => {
      const expectedTokens = tokenizeCompanyName(expectedAlias).filter(
        (token) => !APOLLO_REGIONAL_IDENTITY_TOKENS.has(token)
      );
      const candidateTokens = tokenizeCompanyName(candidateAlias).filter(
        (token) => !APOLLO_REGIONAL_IDENTITY_TOKENS.has(token)
      );

      if (
        expectedTokens.length < 2 ||
        candidateTokens.length < 2 ||
        expectedTokens[0] !== candidateTokens[0] ||
        expectedTokens[0]!.length < 4
      ) {
        return false;
      }

      const expectedRemainder = expectedTokens.slice(1);
      const candidateRemainder = candidateTokens.slice(1);
      const expectedAcronym = expectedRemainder.length === 1
        ? expectedRemainder[0]
        : null;
      const candidateAcronym = candidateRemainder.length === 1
        ? candidateRemainder[0]
        : null;
      const expectedInitials = expectedRemainder.map((token) => token[0]).join("");
      const candidateInitials = candidateRemainder.map((token) => token[0]).join("");

      return (
        Boolean(
          expectedAcronym &&
          expectedAcronym.length >= 2 &&
          expectedAcronym.length <= 6 &&
          candidateRemainder.length >= 2 &&
          expectedAcronym === candidateInitials
        ) ||
        Boolean(
          candidateAcronym &&
          candidateAcronym.length >= 2 &&
          candidateAcronym.length <= 6 &&
          expectedRemainder.length >= 2 &&
          candidateAcronym === expectedInitials
        )
      );
    })
  );
}

function hasSafeScopedLeadingBrandExpansion(
  companyName: string,
  candidateName: string | null
) {
  if (!candidateName || !/\s[-|]\s/u.test(candidateName)) {
    return false;
  }

  const expectedTokens = tokenizeCompanyName(companyName);
  const candidateTokens = tokenizeCompanyName(candidateName);
  const expectedFirstToken = companyName.trim().match(/^([A-Z0-9]{2,6})\b/u)?.[1];

  return Boolean(
    expectedFirstToken &&
    expectedTokens.length === 1 &&
    candidateTokens.length >= 3 &&
    candidateTokens[0] === expectedTokens[0]
  );
}

function normalizeStrictApolloOrganizationName(value: string) {
  const simplified = simplifyCompanySearchName(value);
  return normalizeCompanyName(simplified)
    .split(/\s+/)
    .filter(Boolean)
    .join(" ");
}

function downgradeUnsafeInferredDirectMatch(classification: ApolloCompanyMatchClassification) {
  return classification === ApolloCompanyMatchClassification.DIRECT_COMPANY
    ? ApolloCompanyMatchClassification.MATCH_QUALITY_REVIEW
    : classification;
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
const APOLLO_REGIONAL_IDENTITY_TOKENS = new Set([
  "america",
  "north",
  "canada",
  "united",
  "states"
]);

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

  if (/(repl(y|ied|ies)|respond)/.test(normalized)) {
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

  if (/repl(y|ied|ies)|respond/.test(normalized)) {
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

function parseRetryAfterMs(value: string | null) {
  if (!value) {
    return null;
  }

  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1000, 30_000);
  }

  const retryAt = new Date(value);
  if (Number.isNaN(retryAt.getTime())) {
    return null;
  }

  return Math.min(Math.max(0, retryAt.getTime() - Date.now()), 30_000);
}

function asRecord(value: unknown) {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}
