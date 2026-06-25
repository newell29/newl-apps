import { AssistantSourceKind, IntegrationProvider } from "@prisma/client";

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
    await persistAssistantKnowledgeDocuments(tx, context, documents);
  });

  return {
    documentCount: documents.length,
    mailCount: messages.length,
    fileCount: files.length,
    skipped: false,
    reason: null
  };
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
