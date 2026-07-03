import { AssistantMemoryKind, AssistantSourceKind, IntegrationProvider, type Prisma } from "@prisma/client";

import {
  type AssistantKnowledgeDocumentInput,
  prepareAssistantKnowledgeDocuments,
  persistAssistantKnowledgeDocuments
} from "@/modules/assistant/knowledge";
import { prisma } from "@/server/db";
import {
  MICROSOFT_GRAPH_CREDENTIAL_NAME,
  parseMicrosoftGraphSettings
} from "@/server/integrations/microsoft-graph";
import {
  MICROSOFT_ENTRA_PROVIDER_ID,
  ensureFreshMicrosoftGraphAccessToken,
  parseMicrosoftGraphDelegatedConnection
} from "@/server/integrations/microsoft-graph-account";
import { getMicrosoftGraphApplicationAccessToken } from "@/server/integrations/microsoft-graph-application";
import type { AuthenticatedContext, TenantContext } from "@/server/tenant-context";

const MICROSOFT_GRAPH_SOURCE_SYSTEMS = ["MICROSOFT_GRAPH_MAIL", "MICROSOFT_GRAPH_FILE"] as const;
const MICROSOFT_GRAPH_REQUEST_TIMEOUT_MS = 45_000;
const MICROSOFT_GRAPH_KNOWLEDGE_TRANSACTION_TIMEOUT_MS = 20_000;

export type MicrosoftGraphKnowledgeSyncResult = {
  documentCount: number;
  mailCount: number;
  fileCount: number;
  skipped: boolean;
  reason: string | null;
};

export type TenantMicrosoftGraphKnowledgeSyncResult = MicrosoftGraphKnowledgeSyncResult & {
  connectedUserCount: number;
  syncedUserCount: number;
  skippedUserCount: number;
  userResults: Array<{
    userId: string;
    userEmail: string;
    skipped: boolean;
    reason: string | null;
    documentCount: number;
    mailCount: number;
    fileCount: number;
  }>;
};

type MicrosoftGraphMailMessage = {
  id: string;
  mailboxAddress?: string | null;
  subject?: string | null;
  bodyPreview?: string | null;
  body?: {
    contentType?: string | null;
    content?: string | null;
  } | null;
  webLink?: string | null;
  internetMessageId?: string | null;
  conversationId?: string | null;
  receivedDateTime?: string | null;
  toRecipients?: Array<{
    emailAddress?: {
      name?: string | null;
      address?: string | null;
    } | null;
  }> | null;
  ccRecipients?: Array<{
    emailAddress?: {
      name?: string | null;
      address?: string | null;
    } | null;
  }> | null;
  from?: {
    emailAddress?: {
      name?: string | null;
      address?: string | null;
    } | null;
  } | null;
};

type MicrosoftGraphDriveItem = {
  id: string;
  name?: string | null;
  webUrl?: string | null;
  lastModifiedDateTime?: string | null;
  size?: number | null;
  file?: {
    mimeType?: string | null;
  } | null;
  lastModifiedBy?: {
    user?: {
      displayName?: string | null;
      email?: string | null;
    } | null;
  } | null;
};

export async function syncMicrosoftGraphAssistantKnowledge(
  context: AuthenticatedContext
): Promise<MicrosoftGraphKnowledgeSyncResult> {
  try {
    return await syncMicrosoftGraphAssistantKnowledgeUnsafe(context);
  } catch (error) {
    return buildMicrosoftGraphSkippedResult(error);
  }
}

async function syncMicrosoftGraphAssistantKnowledgeUnsafe(
  context: AuthenticatedContext
): Promise<MicrosoftGraphKnowledgeSyncResult> {
  const integrationCredential = await prisma.integrationCredential.findFirst({
    where: {
      tenantId: context.tenantId,
      provider: IntegrationProvider.MICROSOFT_GRAPH,
      name: MICROSOFT_GRAPH_CREDENTIAL_NAME
    },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    select: {
      provider: true,
      status: true,
      publicConfig: true
    }
  });
  const settings = parseMicrosoftGraphSettings(integrationCredential);

  if (!settings.mailSyncEnabled && !settings.fileSyncEnabled) {
    return {
      documentCount: 0,
      mailCount: 0,
      fileCount: 0,
      skipped: true,
      reason: "Microsoft 365 sync is disabled for this tenant."
    };
  }

  if (settings.mailboxAccessMode === "ADMIN_SELECTED_MAILBOXES") {
    return syncMicrosoftGraphApplicationMailboxKnowledge(context, settings);
  }

  const account = await prisma.account.findFirst({
    where: {
      userId: context.userId,
      provider: MICROSOFT_ENTRA_PROVIDER_ID
    },
    select: {
      id: true,
      access_token: true,
      refresh_token: true,
      expires_at: true,
      scope: true,
      token_type: true
    }
  });
  const delegatedConnection = parseMicrosoftGraphDelegatedConnection(account);

  if (!delegatedConnection.connected || !account?.access_token) {
    if (!account?.refresh_token) {
      return {
        documentCount: 0,
        mailCount: 0,
        fileCount: 0,
        skipped: true,
        reason: delegatedConnection.runtimeNotes
      };
    }
  }

  let accessToken = account?.access_token ?? null;

  if (!account) {
    return {
      documentCount: 0,
      mailCount: 0,
      fileCount: 0,
      skipped: true,
      reason: delegatedConnection.runtimeNotes
    };
  }

  const ensured = await ensureFreshMicrosoftGraphAccessToken(account);
  accessToken = ensured.accessToken;

  if (ensured.refreshed && account.id) {
    await prisma.account.update({
      where: {
        id: account.id
      },
      data: {
        access_token: ensured.accessToken,
        refresh_token: ensured.nextRefreshToken,
        expires_at: ensured.expiresAt,
        scope: ensured.scope,
        token_type: ensured.tokenType
      }
    });
  }

  const [messages, files] = await Promise.all([
    settings.mailSyncEnabled ? fetchRecentMail(accessToken) : Promise.resolve([]),
    settings.fileSyncEnabled ? fetchRecentFiles(accessToken) : Promise.resolve([])
  ]);

  const documents = [
    ...messages.map(mapMessageToKnowledgeDocument),
    ...files.map(mapFileToKnowledgeDocument)
  ];
  const preparedDocuments = prepareAssistantKnowledgeDocuments(documents);

  if (documents.length === 0) {
    return {
      documentCount: 0,
      mailCount: messages.length,
      fileCount: files.length,
      skipped: true,
      reason: "Microsoft Graph returned no recent mailbox or file items."
    };
  }

  await prisma.$transaction(async (tx) => {
    const persistedDocuments = await persistAssistantKnowledgeDocuments(tx, context, preparedDocuments);
    await replaceMicrosoftGraphMemories(tx, context, documents, persistedDocuments);
  }, { timeout: MICROSOFT_GRAPH_KNOWLEDGE_TRANSACTION_TIMEOUT_MS });

  return {
    documentCount: documents.length,
    mailCount: messages.length,
    fileCount: files.length,
    skipped: false,
    reason: null
  };
}

type PersistedMicrosoftDocument = {
  id: string;
  sourceSystem: string;
  externalId: string;
  title: string;
};

type MicrosoftEntityDirectory = {
  companiesByDomain: Map<string, { id: string; name: string; domain: string | null }>;
  companiesByNormalizedName: Map<string, { id: string; name: string; domain: string | null }>;
  contactsByEmail: Map<string, { id: string; fullName: string; email: string | null; companyId: string; companyName: string }>;
};

async function replaceMicrosoftGraphMemories(
  tx: Prisma.TransactionClient,
  context: TenantContext,
  documents: AssistantKnowledgeDocumentInput[],
  persistedDocuments: PersistedMicrosoftDocument[]
) {
  const entityDirectory = await loadMicrosoftEntityDirectory(tx, context.tenantId);
  const documentIdByKey = new Map(
    persistedDocuments.map((document) => [`${document.sourceSystem}:${document.externalId}`, document.id])
  );
  const extractedMemories = buildMicrosoftGraphMemoriesFromDocuments(documents, documentIdByKey, entityDirectory);

  await tx.assistantMemory.deleteMany({
    where: {
      tenantId: context.tenantId,
      sourceRunId: null,
      sourceDocument: {
        is: {
          sourceSystem: {
            in: [...MICROSOFT_GRAPH_SOURCE_SYSTEMS]
          }
        }
      }
    }
  });

  if (extractedMemories.length === 0) {
    return;
  }

  await tx.assistantMemory.createMany({
    data: extractedMemories.map((memory) => ({
      tenantId: context.tenantId,
      kind: memory.kind,
      subjectType: memory.subjectType,
      subjectId: memory.subjectId,
      title: memory.title,
      summary: memory.summary,
      confidence: memory.confidence,
      status: "ACTIVE",
      sourceDocumentId: memory.sourceDocumentId,
      lastObservedAt: memory.lastObservedAt
    }))
  });
}

export function buildMicrosoftGraphMemoriesFromDocuments(
  documents: AssistantKnowledgeDocumentInput[],
  documentIdByKey: Map<string, string>,
  entityDirectory: MicrosoftEntityDirectory = {
    companiesByDomain: new Map(),
    companiesByNormalizedName: new Map(),
    contactsByEmail: new Map()
  }
) {
  const memories: Array<{
    kind: AssistantMemoryKind;
    subjectType: string;
    subjectId: string | null;
    title: string;
    summary: string;
    confidence: number;
    sourceDocumentId: string | null;
    lastObservedAt: Date | null;
  }> = [];
  const contactFacts = new Map<
    string,
    {
      subjectType: string;
      subjectId: string | null;
      title: string;
      contactNames: Set<string>;
      emails: Set<string>;
      phones: Set<string>;
      websites: Set<string>;
      services: Set<string>;
      sourceDocumentId: string | null;
      lastObservedAt: Date | null;
    }
  >();
  const companyFacts = new Map<
    string,
    {
      subjectType: string;
      subjectId: string | null;
      title: string;
      companyNames: Set<string>;
      domains: Set<string>;
      websites: Set<string>;
      services: Set<string>;
      sourceDocumentId: string | null;
      lastObservedAt: Date | null;
    }
  >();
  const serviceFacts = new Map<
    string,
    {
      subjectType: string;
      subjectId: string | null;
      title: string;
      services: Set<string>;
      websites: Set<string>;
      sourceDocumentId: string | null;
      lastObservedAt: Date | null;
    }
  >();

  for (const document of documents) {
    const metadata = document.metadata ?? {};
    const content = document.content;
    const phones = extractPhones(content);
    const websites = extractWebsites(content);
    const services = detectServices(content);
    const lower = content.toLowerCase();
    const sourceDocumentId = documentIdByKey.get(`${document.sourceSystem}:${document.externalId}`) ?? null;
    const lastObservedAt = document.sourceUpdatedAt ?? null;

    if (document.sourceKind === AssistantSourceKind.EMAIL) {
      const fromName = readString(metadata.fromName);
      const fromAddress = readString(metadata.fromAddress);
      const domain = normalizeDomain(fromAddress?.split("@")[1] ?? null);
      const contactMatch = fromAddress ? entityDirectory.contactsByEmail.get(fromAddress.toLowerCase()) ?? null : null;
      const companyMatch =
        (contactMatch ? findCompanyById(entityDirectory, contactMatch.companyId) : null) ??
        (domain ? entityDirectory.companiesByDomain.get(domain) ?? null : null) ??
        (() => {
          const inferred = inferCompanyName(fromName, domain);
          return inferred
            ? entityDirectory.companiesByNormalizedName.get(normalizeCompanyName(inferred)) ?? null
            : null;
        })();
      const companyName = companyMatch?.name ?? inferCompanyName(fromName, domain);
      const website = domain && !websites.includes(`https://${domain}`) ? `https://${domain}` : null;

      if (fromAddress || companyName || phones.length > 0 || websites.length > 0 || services.length > 0) {
        const subjectType = contactMatch ? "Contact" : "MicrosoftGraphContact";
        const subjectId = contactMatch?.id ?? fromAddress ?? document.externalId;
        const title = contactMatch
          ? `${contactMatch.fullName} contact memory`
          : companyName
            ? `${companyName} contact memory`
            : `${document.title} contact memory`;
        const key = `${subjectType}:${subjectId ?? title}`;
        const fact = getOrCreateContactFact(contactFacts, key, {
          subjectType,
          subjectId,
          title,
          sourceDocumentId,
          lastObservedAt
        });
        if (fromName) fact.contactNames.add(fromName);
        if (contactMatch?.fullName) fact.contactNames.add(contactMatch.fullName);
        if (fromAddress) fact.emails.add(fromAddress);
        phones.forEach((phone) => fact.phones.add(phone));
        if (website) fact.websites.add(website);
        websites.forEach((link) => fact.websites.add(link));
        services.forEach((service) => fact.services.add(service));
        updateLastObserved(fact, lastObservedAt, sourceDocumentId);
      }

      if (companyName || domain || services.length > 0) {
        const subjectType = companyMatch ? "Company" : "MicrosoftGraphCompany";
        const subjectId = companyMatch?.id ?? domain ?? companyName ?? document.externalId;
        const title = companyMatch
          ? `${companyMatch.name} company memory`
          : companyName
            ? `${companyName} company memory`
            : `${document.title} company memory`;
        const key = `${subjectType}:${subjectId ?? title}`;
        const fact = getOrCreateCompanyFact(companyFacts, key, {
          subjectType,
          subjectId,
          title,
          sourceDocumentId,
          lastObservedAt
        });
        if (companyName) fact.companyNames.add(companyName);
        if (companyMatch?.name) fact.companyNames.add(companyMatch.name);
        if (domain) fact.domains.add(domain);
        if (companyMatch?.domain) fact.domains.add(companyMatch.domain);
        if (website) fact.websites.add(website);
        websites.forEach((link) => fact.websites.add(link));
        services.forEach((service) => fact.services.add(service));
        updateLastObserved(fact, lastObservedAt, sourceDocumentId);
      }

      if (services.length > 0) {
        const baseSubjectId = companyMatch?.id ?? contactMatch?.companyId ?? companyName ?? document.externalId;
        const key = `service:${baseSubjectId}`;
        const title = companyMatch?.name
          ? `${companyMatch.name} service context`
          : companyName
            ? `${companyName} service context`
            : `${document.title} service context`;
        const fact = getOrCreateServiceFact(serviceFacts, key, {
          subjectType: companyMatch ? "CompanyService" : "MicrosoftGraphService",
          subjectId: baseSubjectId,
          title,
          sourceDocumentId,
          lastObservedAt
        });
        services.forEach((service) => fact.services.add(service));
        if (website) fact.websites.add(website);
        websites.forEach((link) => fact.websites.add(link));
        updateLastObserved(fact, lastObservedAt, sourceDocumentId);
      }

      if (containsOperationalRisk(lower)) {
        memories.push({
          kind: AssistantMemoryKind.OPERATIONAL_RISK,
          subjectType: "MicrosoftGraphIssue",
          subjectId: `${document.externalId}:risk`,
          title: `${document.title} issue signal`,
          summary: summarizeRiskContent(content),
          confidence: 74,
          sourceDocumentId,
          lastObservedAt
        });
      }

      if (containsSalesOpportunity(lower)) {
        memories.push({
          kind: AssistantMemoryKind.SALES_OPPORTUNITY,
          subjectType: "MicrosoftGraphOpportunity",
          subjectId: `${document.externalId}:opportunity`,
          title: `${document.title} opportunity signal`,
          summary: summarizeOpportunityContent(content, services),
          confidence: 74,
          sourceDocumentId,
          lastObservedAt
        });
      }
    }

    if (document.sourceKind === AssistantSourceKind.ONEDRIVE_FILE) {
      if (services.length > 0 || websites.length > 0) {
        const key = `service:file:${document.externalId}`;
        const fact = getOrCreateServiceFact(serviceFacts, key, {
          subjectType: "MicrosoftGraphService",
          subjectId: `${document.externalId}:file`,
          title: `${document.title} file context`,
          sourceDocumentId,
          lastObservedAt
        });
        services.forEach((service) => fact.services.add(service));
        websites.forEach((link) => fact.websites.add(link));
        updateLastObserved(fact, lastObservedAt, sourceDocumentId);
      }
    }
  }

  for (const fact of contactFacts.values()) {
    memories.push({
      kind: AssistantMemoryKind.CUSTOMER_PROFILE,
      subjectType: fact.subjectType,
      subjectId: fact.subjectId,
      title: fact.title,
      summary: joinParts([
        fact.contactNames.size > 0 ? `contact ${Array.from(fact.contactNames).join(", ")}` : null,
        fact.emails.size > 0 ? `emails ${Array.from(fact.emails).join(", ")}` : null,
        fact.phones.size > 0 ? `phones ${Array.from(fact.phones).join(", ")}` : null,
        fact.websites.size > 0 ? `websites ${Array.from(fact.websites).join(", ")}` : null,
        fact.services.size > 0 ? `services ${Array.from(fact.services).join(", ")}` : null
      ]),
      confidence: fact.subjectType === "Contact" ? 84 : 72,
      sourceDocumentId: fact.sourceDocumentId,
      lastObservedAt: fact.lastObservedAt
    });
  }

  for (const fact of companyFacts.values()) {
    memories.push({
      kind: AssistantMemoryKind.CUSTOMER_PROFILE,
      subjectType: fact.subjectType,
      subjectId: fact.subjectId,
      title: fact.title,
      summary: joinParts([
        fact.companyNames.size > 0 ? `company ${Array.from(fact.companyNames).join(", ")}` : null,
        fact.domains.size > 0 ? `domains ${Array.from(fact.domains).join(", ")}` : null,
        fact.websites.size > 0 ? `websites ${Array.from(fact.websites).join(", ")}` : null,
        fact.services.size > 0 ? `services ${Array.from(fact.services).join(", ")}` : null
      ]),
      confidence: fact.subjectType === "Company" ? 82 : 64,
      sourceDocumentId: fact.sourceDocumentId,
      lastObservedAt: fact.lastObservedAt
    });
  }

  for (const fact of serviceFacts.values()) {
    memories.push({
      kind: AssistantMemoryKind.SERVICE_CAPABILITY,
      subjectType: fact.subjectType,
      subjectId: fact.subjectId,
      title: fact.title,
      summary: joinParts([
        fact.services.size > 0 ? `services ${Array.from(fact.services).join(", ")}` : null,
        fact.websites.size > 0 ? `links ${Array.from(fact.websites).join(", ")}` : null
      ]),
      confidence: fact.subjectType === "CompanyService" ? 78 : 64,
      sourceDocumentId: fact.sourceDocumentId,
      lastObservedAt: fact.lastObservedAt
    });
  }

  return dedupeMemories(memories);
}

async function syncMicrosoftGraphApplicationMailboxKnowledge(
  context: TenantContext,
  settings: ReturnType<typeof parseMicrosoftGraphSettings>
): Promise<MicrosoftGraphKnowledgeSyncResult> {
  if (!settings.crossMailboxReady) {
    return {
      documentCount: 0,
      mailCount: 0,
      fileCount: 0,
      skipped: true,
      reason: settings.runtimeNotes
    };
  }

  const accessToken = await getMicrosoftGraphApplicationAccessToken();
  const mailboxResult = settings.mailSyncEnabled
    ? await fetchSelectedMailboxMessages(accessToken, settings.adminMailboxTargets)
    : { messages: [], failures: [] };
  const messages = mailboxResult.messages;
  const files: MicrosoftGraphDriveItem[] = [];
  const documents = messages.map(mapMessageToKnowledgeDocument);
  const preparedDocuments = prepareAssistantKnowledgeDocuments(documents);
  const mailboxFailureReason =
    mailboxResult.failures.length > 0
      ? `Mailbox sync issue(s): ${mailboxResult.failures
          .map((failure) => `${failure.mailbox}: ${failure.reason}`)
          .join(" | ")}`
      : null;

  if (documents.length === 0) {
    return {
      documentCount: 0,
      mailCount: messages.length,
      fileCount: files.length,
      skipped: true,
      reason: mailboxFailureReason ?? "Microsoft Graph returned no recent items for the selected admin mailboxes."
    };
  }

  await prisma.$transaction(async (tx) => {
    const persistedDocuments = await persistAssistantKnowledgeDocuments(tx, context, preparedDocuments);
    await replaceMicrosoftGraphMemories(tx, context, documents, persistedDocuments);
  }, { timeout: MICROSOFT_GRAPH_KNOWLEDGE_TRANSACTION_TIMEOUT_MS });

  return {
    documentCount: documents.length,
    mailCount: messages.length,
    fileCount: files.length,
    skipped: mailboxResult.failures.length > 0,
    reason: mailboxFailureReason
  };
}

export async function syncTenantMicrosoftGraphAssistantKnowledge(
  tenant: TenantContext
): Promise<TenantMicrosoftGraphKnowledgeSyncResult> {
  try {
    return await syncTenantMicrosoftGraphAssistantKnowledgeUnsafe(tenant);
  } catch (error) {
    const result = buildMicrosoftGraphSkippedResult(error);

    return {
      ...result,
      connectedUserCount: 0,
      syncedUserCount: 0,
      skippedUserCount: 0,
      userResults: []
    };
  }
}

async function syncTenantMicrosoftGraphAssistantKnowledgeUnsafe(
  tenant: TenantContext
): Promise<TenantMicrosoftGraphKnowledgeSyncResult> {
  const integrationCredential = await prisma.integrationCredential.findFirst({
    where: {
      tenantId: tenant.tenantId,
      provider: IntegrationProvider.MICROSOFT_GRAPH,
      name: MICROSOFT_GRAPH_CREDENTIAL_NAME
    },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    select: {
      provider: true,
      status: true,
      publicConfig: true
    }
  });
  const settings = parseMicrosoftGraphSettings(integrationCredential);

  if (settings.mailboxAccessMode === "ADMIN_SELECTED_MAILBOXES") {
    const result = await syncMicrosoftGraphApplicationMailboxKnowledge(tenant, settings);

    return {
      ...result,
      connectedUserCount: settings.adminMailboxTargets.length,
      syncedUserCount: result.skipped ? 0 : settings.adminMailboxTargets.length,
      skippedUserCount: result.skipped ? settings.adminMailboxTargets.length : 0,
      userResults: settings.adminMailboxTargets.map((mailbox) => ({
        userId: mailbox,
        userEmail: mailbox,
        skipped: result.skipped,
        reason: result.reason,
        documentCount: result.documentCount,
        mailCount: result.mailCount,
        fileCount: result.fileCount
      }))
    };
  }

  const memberships = await prisma.membership.findMany({
    where: {
      tenantId: tenant.tenantId
    },
    select: {
      role: true,
      user: {
        select: {
          id: true,
          email: true,
          name: true,
          accounts: {
            where: {
              provider: MICROSOFT_ENTRA_PROVIDER_ID
            },
            select: {
              id: true
            },
            take: 1
          }
        }
      }
    },
    orderBy: {
      createdAt: "asc"
    }
  });

  const connectedUsers = memberships.filter((membership) => membership.user.accounts.length > 0);
  const userResults: TenantMicrosoftGraphKnowledgeSyncResult["userResults"] = [];

  for (const membership of connectedUsers) {
    const result = await syncMicrosoftGraphAssistantKnowledge({
      tenantId: tenant.tenantId,
      tenantSlug: tenant.tenantSlug,
      tenantName: tenant.tenantName,
      userId: membership.user.id,
      userEmail: membership.user.email,
      userName: membership.user.name,
      role: membership.role
    });

    userResults.push({
      userId: membership.user.id,
      userEmail: membership.user.email,
      skipped: result.skipped,
      reason: result.reason,
      documentCount: result.documentCount,
      mailCount: result.mailCount,
      fileCount: result.fileCount
    });
  }

  const skippedUserCount = userResults.filter((result) => result.skipped).length;
  const syncedUserCount = userResults.length - skippedUserCount;

  return {
    documentCount: userResults.reduce((sum, result) => sum + result.documentCount, 0),
    mailCount: userResults.reduce((sum, result) => sum + result.mailCount, 0),
    fileCount: userResults.reduce((sum, result) => sum + result.fileCount, 0),
    skipped: syncedUserCount === 0,
    reason:
      connectedUsers.length === 0
        ? "No tenant users have connected Microsoft 365 delegated access yet."
        : syncedUserCount === 0
          ? "All connected Microsoft 365 users were skipped."
          : null,
    connectedUserCount: connectedUsers.length,
    syncedUserCount,
    skippedUserCount,
    userResults
  };
}

async function loadMicrosoftEntityDirectory(tx: Prisma.TransactionClient, tenantId: string): Promise<MicrosoftEntityDirectory> {
  const [companies, contacts] = await Promise.all([
    tx.company.findMany({
      where: { tenantId },
      select: {
        id: true,
        name: true,
        normalizedName: true,
        domain: true
      }
    }),
    tx.contact.findMany({
      where: { tenantId },
      select: {
        id: true,
        fullName: true,
        email: true,
        companyId: true,
        company: {
          select: {
            name: true
          }
        }
      }
    })
  ]);

  const companiesByDomain = new Map<string, { id: string; name: string; domain: string | null }>();
  const companiesByNormalizedName = new Map<string, { id: string; name: string; domain: string | null }>();
  const contactsByEmail = new Map<string, { id: string; fullName: string; email: string | null; companyId: string; companyName: string }>();

  for (const company of companies) {
    const record = {
      id: company.id,
      name: company.name,
      domain: company.domain
    };
    if (company.domain) {
      companiesByDomain.set(normalizeDomain(company.domain), record);
    }
    companiesByNormalizedName.set(normalizeCompanyName(company.normalizedName || company.name), record);
  }

  for (const contact of contacts) {
    if (!contact.email) {
      continue;
    }
    contactsByEmail.set(contact.email.toLowerCase(), {
      id: contact.id,
      fullName: contact.fullName,
      email: contact.email,
      companyId: contact.companyId,
      companyName: contact.company.name
    });
  }

  return {
    companiesByDomain,
    companiesByNormalizedName,
    contactsByEmail
  };
}

async function fetchRecentMail(accessToken: string) {
  return fetchMailboxMessages(accessToken, "me");
}

async function fetchSelectedMailboxMessages(accessToken: string, mailboxes: string[]) {
  const results = await Promise.all(
    mailboxes.map(async (mailbox) => {
      try {
        return {
          mailbox,
          messages: await fetchMailboxMessages(accessToken, mailbox),
          reason: null
        };
      } catch (error) {
        return {
          mailbox,
          messages: [] as MicrosoftGraphMailMessage[],
          reason: error instanceof Error ? error.message : "Unknown Microsoft Graph mailbox error."
        };
      }
    })
  );

  return {
    messages: results
      .flatMap((result) => result.messages)
    .sort((left, right) => {
      const leftTime = parseDate(left.receivedDateTime)?.getTime() ?? 0;
      const rightTime = parseDate(right.receivedDateTime)?.getTime() ?? 0;
      return rightTime - leftTime;
    })
      .slice(0, 25),
    failures: results.flatMap((result) =>
      result.reason
        ? [
            {
              mailbox: result.mailbox,
              reason: result.reason
            }
          ]
        : []
    )
  };
}

async function fetchMailboxMessages(accessToken: string, mailbox: string) {
  const path = mailbox === "me" ? "me/messages" : await resolveMailboxMessagesPath(accessToken, mailbox);
  const response = await fetch(
    `https://graph.microsoft.com/v1.0/${path}?$top=10&$select=id,subject,bodyPreview,body,webLink,internetMessageId,conversationId,receivedDateTime,from,toRecipients,ccRecipients&$orderby=receivedDateTime%20desc`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Prefer: 'outlook.body-content-type="text"'
      },
      cache: "no-store",
      signal: AbortSignal.timeout(MICROSOFT_GRAPH_REQUEST_TIMEOUT_MS)
    }
  );

  if (!response.ok) {
    throw new Error(
      (await extractMicrosoftGraphResponseError(response)) ??
        `Microsoft Graph mail sync failed for ${mailbox} with status ${response.status}.`
    );
  }

  const json = (await response.json()) as { value?: MicrosoftGraphMailMessage[] };
  return Array.isArray(json.value)
    ? json.value.map((message) => ({
        ...message,
        mailboxAddress: mailbox === "me" ? null : mailbox
      }))
    : [];
}

async function resolveMailboxMessagesPath(accessToken: string, mailbox: string) {
  const directPath = `users/${encodeURIComponent(mailbox)}/messages`;
  const probeResponse = await fetch(`https://graph.microsoft.com/v1.0/${directPath}?$top=1&$select=id`, {
    headers: {
      Authorization: `Bearer ${accessToken}`
    },
    cache: "no-store",
    signal: AbortSignal.timeout(MICROSOFT_GRAPH_REQUEST_TIMEOUT_MS)
  });

  if (probeResponse.ok) {
    return directPath;
  }

  const probeError = await extractMicrosoftGraphResponseError(probeResponse);
  if (!probeError?.includes("ErrorInvalidUser")) {
    throw new Error(
      probeError ?? `Microsoft Graph mail sync failed for ${mailbox} with status ${probeResponse.status}.`
    );
  }

  const resolvedUserId = await resolveMailboxUserId(accessToken, mailbox);
  if (!resolvedUserId) {
    throw new Error(probeError);
  }

  return `users/${encodeURIComponent(resolvedUserId)}/messages`;
}

async function resolveMailboxUserId(accessToken: string, mailbox: string) {
  const normalizedMailbox = mailbox.trim().toLowerCase();
  const lookups = [
    `https://graph.microsoft.com/v1.0/users?$top=5&$select=id,mail,userPrincipalName&$filter=${encodeURIComponent(
      `mail eq '${escapeODataString(normalizedMailbox)}' or userPrincipalName eq '${escapeODataString(normalizedMailbox)}'`
    )}`,
    `https://graph.microsoft.com/v1.0/users?$top=5&$select=id,mail,userPrincipalName,proxyAddresses&$filter=${encodeURIComponent(
      `proxyAddresses/any(x:x eq 'smtp:${escapeODataString(normalizedMailbox)}' or x eq 'SMTP:${escapeODataString(normalizedMailbox)}')`
    )}`
  ];

  for (const url of lookups) {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ConsistencyLevel: "eventual"
      },
      cache: "no-store",
      signal: AbortSignal.timeout(MICROSOFT_GRAPH_REQUEST_TIMEOUT_MS)
    });

    if (!response.ok) {
      continue;
    }

    const json = (await response.json()) as {
      value?: Array<{
        id?: string | null;
        mail?: string | null;
        userPrincipalName?: string | null;
        proxyAddresses?: string[] | null;
      }>;
    };
    const match = (json.value ?? []).find((entry) => {
      const mail = entry.mail?.trim().toLowerCase() ?? null;
      const userPrincipalName = entry.userPrincipalName?.trim().toLowerCase() ?? null;
      const proxyAddresses = (entry.proxyAddresses ?? []).map((value) => value.trim().toLowerCase());

      return (
        mail === normalizedMailbox ||
        userPrincipalName === normalizedMailbox ||
        proxyAddresses.includes(`smtp:${normalizedMailbox}`)
      );
    });

    if (match?.id) {
      return match.id;
    }
  }

  return null;
}

async function fetchRecentFiles(accessToken: string) {
  const response = await fetch("https://graph.microsoft.com/v1.0/me/drive/recent", {
    headers: {
      Authorization: `Bearer ${accessToken}`
    },
    cache: "no-store",
    signal: AbortSignal.timeout(MICROSOFT_GRAPH_REQUEST_TIMEOUT_MS)
  });

  if (!response.ok) {
    throw new Error(
      (await extractMicrosoftGraphResponseError(response)) ??
        `Microsoft Graph file sync failed with status ${response.status}.`
    );
  }

  const json = (await response.json()) as { value?: MicrosoftGraphDriveItem[] };
  return Array.isArray(json.value) ? json.value : [];
}

function mapMessageToKnowledgeDocument(message: MicrosoftGraphMailMessage): AssistantKnowledgeDocumentInput {
  const fromName = message.from?.emailAddress?.name ?? null;
  const fromAddress = message.from?.emailAddress?.address ?? null;
  const mailboxAddress = message.mailboxAddress ?? null;
  const toRecipients = flattenRecipients(message.toRecipients);
  const ccRecipients = flattenRecipients(message.ccRecipients);
  const receivedAt = parseDate(message.receivedDateTime);
  const subject = message.subject?.trim() || "Untitled email";
  const fromLine = fromName && fromAddress ? `${fromName} <${fromAddress}>` : fromName ?? fromAddress;
  const bodyContent = normalizeBodyContent(message.body?.content ?? null);
  const content = [
    `Microsoft 365 email message.`,
    mailboxAddress ? `Mailbox: ${mailboxAddress}.` : null,
    fromLine ? `From: ${fromLine}.` : null,
    toRecipients.length > 0 ? `To: ${toRecipients.join("; ")}.` : null,
    ccRecipients.length > 0 ? `Cc: ${ccRecipients.join("; ")}.` : null,
    receivedAt ? `Received at: ${receivedAt.toISOString()}.` : null,
    message.bodyPreview ? `Preview: ${message.bodyPreview}.` : null,
    bodyContent ? `Body: ${bodyContent}.` : null
  ]
    .filter((value): value is string => Boolean(value))
    .join(" ");

  return {
    sourceKind: AssistantSourceKind.EMAIL,
    sourceSystem: "MICROSOFT_GRAPH_MAIL",
    externalId: mailboxAddress ? `${mailboxAddress}:${message.id}` : message.id,
    title: subject,
    canonicalUrl: message.webLink ?? null,
    sourceUpdatedAt: receivedAt,
    metadata: {
      mailboxAddress,
      fromName,
      fromAddress,
      receivedDateTime: message.receivedDateTime ?? null,
      internetMessageId: message.internetMessageId ?? null,
      conversationId: message.conversationId ?? null,
      toRecipients,
      ccRecipients
    },
    content
  };
}

function mapFileToKnowledgeDocument(item: MicrosoftGraphDriveItem): AssistantKnowledgeDocumentInput {
  const modifiedAt = parseDate(item.lastModifiedDateTime);
  const modifiedBy =
    item.lastModifiedBy?.user?.displayName ?? item.lastModifiedBy?.user?.email ?? null;
  const title = item.name?.trim() || "Recent Microsoft 365 file";
  const content = [
    `Microsoft 365 recent file.`,
    `Name: ${title}.`,
    item.file?.mimeType ? `Mime type: ${item.file.mimeType}.` : null,
    modifiedAt ? `Last modified at: ${modifiedAt.toISOString()}.` : null,
    modifiedBy ? `Last modified by: ${modifiedBy}.` : null,
    typeof item.size === "number" ? `Size: ${item.size} bytes.` : null
  ]
    .filter((value): value is string => Boolean(value))
    .join(" ");

  return {
    sourceKind: AssistantSourceKind.ONEDRIVE_FILE,
    sourceSystem: "MICROSOFT_GRAPH_FILE",
    externalId: item.id,
    title,
    canonicalUrl: item.webUrl ?? null,
    sourceUpdatedAt: modifiedAt,
    metadata: {
      webUrl: item.webUrl ?? null,
      mimeType: item.file?.mimeType ?? null,
      modifiedBy,
      size: item.size ?? null
    },
    content
  };
}

function parseDate(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function flattenRecipients(
  recipients:
    | Array<{
        emailAddress?: {
          name?: string | null;
          address?: string | null;
        } | null;
      }>
    | null
    | undefined
) {
  return (recipients ?? [])
    .map((recipient) => {
      const name = recipient.emailAddress?.name?.trim();
      const address = recipient.emailAddress?.address?.trim();
      if (name && address) {
        return `${name} <${address}>`;
      }
      return name ?? address ?? null;
    })
    .filter((value): value is string => Boolean(value));
}

function normalizeBodyContent(value: string | null) {
  if (!value) {
    return null;
  }

  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return null;
  }

  return truncateText(normalized, 4000);
}

function extractPhones(value: string) {
  return Array.from(
    new Set(
      (value.match(/(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}/g) ?? []).map((phone) => phone.trim())
    )
  );
}

function extractWebsites(value: string) {
  return Array.from(new Set(value.match(/https?:\/\/[^\s)]+/gi) ?? []));
}

function detectServices(value: string) {
  const normalized = value.toLowerCase();
  const catalog = [
    "ltl",
    "ftl",
    "truckload",
    "parcel",
    "ups",
    "warehousing",
    "warehouse",
    "storage",
    "distribution",
    "drayage",
    "intermodal",
    "expedited",
    "air freight",
    "ocean freight",
    "customs",
    "transload"
  ];

  return catalog.filter((service) => normalized.includes(service));
}

function containsOperationalRisk(value: string) {
  return ["delay", "late", "issue", "problem", "complaint", "claim", "damaged", "urgent", "escalat", "missed"].some(
    (term) => value.includes(term)
  );
}

function containsSalesOpportunity(value: string) {
  return ["quote", "pricing", "rate", "lane", "opportunity", "new shipment", "tender", "rfq", "bid"].some((term) =>
    value.includes(term)
  );
}

function summarizeRiskContent(content: string) {
  return truncateText(`Operational issue signal from Microsoft email: ${content}`, 220);
}

function summarizeOpportunityContent(content: string, services: string[]) {
  return truncateText(
    joinParts([
      "Sales opportunity signal from Microsoft email.",
      services.length > 0 ? `Services referenced ${services.join(", ")}.` : null,
      content
    ]),
    220
  );
}

function inferCompanyName(fromName: string | null, domain: string | null) {
  if (fromName && !fromName.includes("@")) {
    return fromName.replace(/\b(inc|llc|ltd|corp|corporation)\b/gi, (match) => match.toUpperCase()).trim();
  }

  if (!domain) {
    return null;
  }

  const root = domain.split(".")[0] ?? "";
  if (!root) {
    return null;
  }

  return root
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function normalizeDomain(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase().replace(/^www\./, "");
}

function normalizeCompanyName(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function findCompanyById(directory: MicrosoftEntityDirectory, companyId: string) {
  for (const company of directory.companiesByDomain.values()) {
    if (company.id === companyId) {
      return company;
    }
  }

  for (const company of directory.companiesByNormalizedName.values()) {
    if (company.id === companyId) {
      return company;
    }
  }

  return null;
}

function joinParts(parts: Array<string | null>) {
  return parts.filter((part): part is string => Boolean(part)).join(", ");
}

function truncateText(value: string, maxLength: number) {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 3).trimEnd()}...`;
}

function dedupeMemories<T extends { kind: AssistantMemoryKind; subjectType: string; subjectId: string | null; title: string }>(
  memories: T[]
) {
  const seen = new Set<string>();
  return memories.filter((memory) => {
    const key = `${memory.kind}:${memory.subjectType}:${memory.subjectId ?? memory.title}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function buildMicrosoftGraphSkippedResult(error: unknown): MicrosoftGraphKnowledgeSyncResult {
  return {
    documentCount: 0,
    mailCount: 0,
    fileCount: 0,
    skipped: true,
    reason: formatMicrosoftGraphError(error)
  };
}

function formatMicrosoftGraphError(error: unknown) {
  const message = error instanceof Error ? error.message : "Microsoft 365 sync failed for an unknown reason.";
  return message.startsWith("Microsoft")
    ? message
    : `Microsoft 365 sync failed: ${message}`;
}

async function extractMicrosoftGraphResponseError(response: Response) {
  const json = (await response.json().catch(() => null)) as
    | {
        error?: {
          code?: string;
          message?: string;
        };
      }
    | null;
  const code = json?.error?.code;
  const message = json?.error?.message;

  if (!code && !message) {
    return null;
  }

  return `Microsoft Graph request failed with status ${response.status}${code ? ` (${code})` : ""}${message ? `: ${message}` : ""}.`;
}

function getOrCreateContactFact(
  facts: Map<
    string,
    {
      subjectType: string;
      subjectId: string | null;
      title: string;
      contactNames: Set<string>;
      emails: Set<string>;
      phones: Set<string>;
      websites: Set<string>;
      services: Set<string>;
      sourceDocumentId: string | null;
      lastObservedAt: Date | null;
    }
  >,
  key: string,
  seed: {
    subjectType: string;
    subjectId: string | null;
    title: string;
    sourceDocumentId: string | null;
    lastObservedAt: Date | null;
  }
) {
  const existing = facts.get(key);
  if (existing) {
    return existing;
  }

  const created = {
    ...seed,
    contactNames: new Set<string>(),
    emails: new Set<string>(),
    phones: new Set<string>(),
    websites: new Set<string>(),
    services: new Set<string>()
  };
  facts.set(key, created);
  return created;
}

function escapeODataString(value: string) {
  return value.replace(/'/g, "''");
}

function getOrCreateCompanyFact(
  facts: Map<
    string,
    {
      subjectType: string;
      subjectId: string | null;
      title: string;
      companyNames: Set<string>;
      domains: Set<string>;
      websites: Set<string>;
      services: Set<string>;
      sourceDocumentId: string | null;
      lastObservedAt: Date | null;
    }
  >,
  key: string,
  seed: {
    subjectType: string;
    subjectId: string | null;
    title: string;
    sourceDocumentId: string | null;
    lastObservedAt: Date | null;
  }
) {
  const existing = facts.get(key);
  if (existing) {
    return existing;
  }

  const created = {
    ...seed,
    companyNames: new Set<string>(),
    domains: new Set<string>(),
    websites: new Set<string>(),
    services: new Set<string>()
  };
  facts.set(key, created);
  return created;
}

function getOrCreateServiceFact(
  facts: Map<
    string,
    {
      subjectType: string;
      subjectId: string | null;
      title: string;
      services: Set<string>;
      websites: Set<string>;
      sourceDocumentId: string | null;
      lastObservedAt: Date | null;
    }
  >,
  key: string,
  seed: {
    subjectType: string;
    subjectId: string | null;
    title: string;
    sourceDocumentId: string | null;
    lastObservedAt: Date | null;
  }
) {
  const existing = facts.get(key);
  if (existing) {
    return existing;
  }

  const created = {
    ...seed,
    services: new Set<string>(),
    websites: new Set<string>()
  };
  facts.set(key, created);
  return created;
}

function updateLastObserved(
  fact: {
    sourceDocumentId: string | null;
    lastObservedAt: Date | null;
  },
  candidateDate: Date | null,
  candidateDocumentId: string | null
) {
  if (!fact.lastObservedAt || (candidateDate && candidateDate > fact.lastObservedAt)) {
    fact.lastObservedAt = candidateDate;
    fact.sourceDocumentId = candidateDocumentId;
  }
}
