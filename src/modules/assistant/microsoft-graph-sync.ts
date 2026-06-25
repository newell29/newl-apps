import { AssistantMemoryKind, AssistantSourceKind, IntegrationProvider, type Prisma } from "@prisma/client";

import {
  type AssistantKnowledgeDocumentInput,
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
import type { AuthenticatedContext } from "@/server/tenant-context";

type MicrosoftGraphMailMessage = {
  id: string;
  subject?: string | null;
  bodyPreview?: string | null;
  webLink?: string | null;
  internetMessageId?: string | null;
  receivedDateTime?: string | null;
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

export async function syncMicrosoftGraphAssistantKnowledge(context: AuthenticatedContext) {
  const [integrationCredential, account] = await Promise.all([
    prisma.integrationCredential.findFirst({
      where: {
        tenantId: context.tenantId,
        provider: IntegrationProvider.MICROSOFT_GRAPH,
        name: MICROSOFT_GRAPH_CREDENTIAL_NAME
      },
      select: {
        provider: true,
        status: true,
        publicConfig: true
      }
    }),
    prisma.account.findFirst({
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
    })
  ]);

  const settings = parseMicrosoftGraphSettings(integrationCredential);
  const delegatedConnection = parseMicrosoftGraphDelegatedConnection(account);

  if (!settings.mailSyncEnabled && !settings.fileSyncEnabled) {
    return {
      documentCount: 0,
      mailCount: 0,
      fileCount: 0,
      skipped: true,
      reason: "Microsoft 365 sync is disabled for this tenant."
    };
  }

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
    const persistedDocuments = await persistAssistantKnowledgeDocuments(tx, context, documents);
    await replaceMicrosoftGraphMemories(tx, context, documents, persistedDocuments);
  });

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

async function replaceMicrosoftGraphMemories(
  tx: Prisma.TransactionClient,
  context: AuthenticatedContext,
  documents: AssistantKnowledgeDocumentInput[],
  persistedDocuments: PersistedMicrosoftDocument[]
) {
  const documentIdByKey = new Map(
    persistedDocuments.map((document) => [`${document.sourceSystem}:${document.externalId}`, document.id])
  );
  const extractedMemories = buildMicrosoftGraphMemoriesFromDocuments(documents, documentIdByKey);

  await tx.assistantMemory.deleteMany({
    where: {
      tenantId: context.tenantId,
      sourceRunId: null,
      subjectType: {
        in: ["MicrosoftGraphContact", "MicrosoftGraphCompany", "MicrosoftGraphService", "MicrosoftGraphIssue", "MicrosoftGraphOpportunity"]
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
  documentIdByKey: Map<string, string>
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

  for (const document of documents) {
    const metadata = document.metadata ?? {};
    const content = document.content;
    const emails = extractEmails(content);
    const phones = extractPhones(content);
    const websites = extractWebsites(content);
    const services = detectServices(content);
    const lower = content.toLowerCase();
    const sourceDocumentId = documentIdByKey.get(`${document.sourceSystem}:${document.externalId}`) ?? null;
    const lastObservedAt = document.sourceUpdatedAt ?? null;

    if (document.sourceKind === AssistantSourceKind.EMAIL) {
      const fromName = readString(metadata.fromName);
      const fromAddress = readString(metadata.fromAddress);
      const domain = fromAddress?.split("@")[1] ?? null;
      const companyName = inferCompanyName(fromName, domain);
      const website = domain && !websites.includes(`https://${domain}`) ? `https://${domain}` : null;

      if (fromAddress || companyName || phones.length > 0 || websites.length > 0 || services.length > 0) {
        memories.push({
          kind: AssistantMemoryKind.CUSTOMER_PROFILE,
          subjectType: "MicrosoftGraphContact",
          subjectId: fromAddress ?? document.externalId,
          title: companyName ? `${companyName} contact memory` : `${document.title} contact memory`,
          summary: joinParts([
            fromName ? `Contact name ${fromName}` : null,
            fromAddress ? `email ${fromAddress}` : null,
            phones.length > 0 ? `phones ${phones.join(", ")}` : null,
            website ? `website ${website}` : null,
            websites.length > 0 ? `links ${websites.join(", ")}` : null,
            services.length > 0 ? `services discussed ${services.join(", ")}` : null
          ]),
          confidence: 72,
          sourceDocumentId,
          lastObservedAt
        });
      }

      if (companyName || domain || services.length > 0) {
        memories.push({
          kind: AssistantMemoryKind.CUSTOMER_PROFILE,
          subjectType: "MicrosoftGraphCompany",
          subjectId: domain ?? companyName ?? document.externalId,
          title: companyName ? `${companyName} company memory` : `${document.title} company memory`,
          summary: joinParts([
            companyName ? `Company ${companyName}` : null,
            domain ? `domain ${domain}` : null,
            services.length > 0 ? `service context ${services.join(", ")}` : null
          ]),
          confidence: 64,
          sourceDocumentId,
          lastObservedAt
        });
      }

      if (services.length > 0) {
        memories.push({
          kind: AssistantMemoryKind.SERVICE_CAPABILITY,
          subjectType: "MicrosoftGraphService",
          subjectId: `${document.externalId}:services`,
          title: `${document.title} service context`,
          summary: `Services referenced in email: ${services.join(", ")}.`,
          confidence: 68,
          sourceDocumentId,
          lastObservedAt
        });
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
        memories.push({
          kind: AssistantMemoryKind.SERVICE_CAPABILITY,
          subjectType: "MicrosoftGraphService",
          subjectId: `${document.externalId}:file`,
          title: `${document.title} file context`,
          summary: joinParts([
            services.length > 0 ? `Services referenced ${services.join(", ")}` : null,
            websites.length > 0 ? `related links ${websites.join(", ")}` : null
          ]),
          confidence: 60,
          sourceDocumentId,
          lastObservedAt
        });
      }
    }
  }

  return dedupeMemories(memories);
}

async function fetchRecentMail(accessToken: string) {
  const response = await fetch(
    "https://graph.microsoft.com/v1.0/me/messages?$top=10&$select=id,subject,bodyPreview,webLink,internetMessageId,receivedDateTime,from&$orderby=receivedDateTime%20desc",
    {
      headers: {
        Authorization: `Bearer ${accessToken}`
      },
      cache: "no-store"
    }
  );

  if (!response.ok) {
    throw new Error(`Microsoft Graph mail sync failed with status ${response.status}.`);
  }

  const json = (await response.json()) as { value?: MicrosoftGraphMailMessage[] };
  return Array.isArray(json.value) ? json.value : [];
}

async function fetchRecentFiles(accessToken: string) {
  const response = await fetch("https://graph.microsoft.com/v1.0/me/drive/recent", {
    headers: {
      Authorization: `Bearer ${accessToken}`
    },
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`Microsoft Graph file sync failed with status ${response.status}.`);
  }

  const json = (await response.json()) as { value?: MicrosoftGraphDriveItem[] };
  return Array.isArray(json.value) ? json.value : [];
}

function mapMessageToKnowledgeDocument(message: MicrosoftGraphMailMessage): AssistantKnowledgeDocumentInput {
  const fromName = message.from?.emailAddress?.name ?? null;
  const fromAddress = message.from?.emailAddress?.address ?? null;
  const receivedAt = parseDate(message.receivedDateTime);
  const subject = message.subject?.trim() || "Untitled email";
  const fromLine = fromName && fromAddress ? `${fromName} <${fromAddress}>` : fromName ?? fromAddress;
  const content = [
    `Microsoft 365 email message.`,
    fromLine ? `From: ${fromLine}.` : null,
    receivedAt ? `Received at: ${receivedAt.toISOString()}.` : null,
    message.bodyPreview ? `Preview: ${message.bodyPreview}.` : null
  ]
    .filter((value): value is string => Boolean(value))
    .join(" ");

  return {
    sourceKind: AssistantSourceKind.EMAIL,
    sourceSystem: "MICROSOFT_GRAPH_MAIL",
    externalId: message.id,
    title: subject,
    canonicalUrl: message.webLink ?? null,
    sourceUpdatedAt: receivedAt,
    metadata: {
      fromName,
      fromAddress,
      receivedDateTime: message.receivedDateTime ?? null,
      internetMessageId: message.internetMessageId ?? null
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

function extractEmails(value: string) {
  return Array.from(new Set(value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? []));
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
