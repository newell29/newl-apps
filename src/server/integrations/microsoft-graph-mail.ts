const MICROSOFT_GRAPH_REQUEST_TIMEOUT_MS = 45_000;
const MICROSOFT_GRAPH_MAIL_PAGE_SIZE = 50;

export type MicrosoftGraphMailRecipient = {
  emailAddress?: {
    name?: string | null;
    address?: string | null;
  } | null;
};

export type MicrosoftGraphMailMessage = {
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
  hasAttachments?: boolean | null;
  toRecipients?: MicrosoftGraphMailRecipient[] | null;
  ccRecipients?: MicrosoftGraphMailRecipient[] | null;
  from?: {
    emailAddress?: {
      name?: string | null;
      address?: string | null;
    } | null;
  } | null;
};

export type MicrosoftGraphMailAttachment = {
  id: string;
  name?: string | null;
  contentType?: string | null;
  size?: number | null;
  isInline?: boolean | null;
  contentId?: string | null;
  lastModifiedDateTime?: string | null;
};

export type MicrosoftGraphMailFileAttachment = MicrosoftGraphMailAttachment & {
  "@odata.type"?: string | null;
  contentBytes?: string | null;
};

export type MicrosoftGraphMailFetchOptions = {
  lookbackDays: number;
  maxMessagesPerMailbox: number;
};

export async function fetchMicrosoftGraphMailboxMessages(
  accessToken: string,
  mailbox: string,
  options: MicrosoftGraphMailFetchOptions
) {
  const path = mailbox === "me" ? "me/messages" : await resolveMicrosoftGraphMailboxMessagesPath(accessToken, mailbox);
  const since = new Date(Date.now() - options.lookbackDays * 24 * 60 * 60 * 1000);
  const messages: MicrosoftGraphMailMessage[] = [];
  let nextUrl: string | null = buildMailboxMessagesUrl(path, since, options.maxMessagesPerMailbox);

  while (nextUrl && messages.length < options.maxMessagesPerMailbox) {
    const page = await fetchMailboxMessagesPage(accessToken, mailbox, nextUrl);
    messages.push(...page.messages);
    nextUrl = messages.length < options.maxMessagesPerMailbox ? page.nextLink : null;
  }

  return messages.slice(0, options.maxMessagesPerMailbox);
}

export async function fetchMicrosoftGraphMessageAttachments(accessToken: string, mailbox: string, messageId: string) {
  const messagePath = mailbox === "me" ? "me/messages" : await resolveMicrosoftGraphMailboxMessagesPath(accessToken, mailbox);
  const url = `https://graph.microsoft.com/v1.0/${messagePath}/${encodeURIComponent(messageId)}/attachments?$select=id,name,contentType,size,isInline,lastModifiedDateTime`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
    signal: AbortSignal.timeout(MICROSOFT_GRAPH_REQUEST_TIMEOUT_MS)
  });

  if (!response.ok) {
    throw new Error(
      (await extractMicrosoftGraphResponseError(response)) ??
        `Microsoft Graph attachment sync failed for ${mailbox} message ${messageId} with status ${response.status}.`
    );
  }

  const json = (await response.json()) as { value?: MicrosoftGraphMailAttachment[] };
  return Array.isArray(json.value) ? json.value : [];
}

export async function fetchMicrosoftGraphMessageAttachmentContent(
  accessToken: string,
  mailbox: string,
  messageId: string,
  attachmentId: string
) {
  const messagePath = mailbox === "me" ? "me/messages" : await resolveMicrosoftGraphMailboxMessagesPath(accessToken, mailbox);
  const select = "id,name,contentType,size,isInline,lastModifiedDateTime,contentBytes";
  const url = `https://graph.microsoft.com/v1.0/${messagePath}/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(
    attachmentId
  )}?$select=${select}`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
    signal: AbortSignal.timeout(MICROSOFT_GRAPH_REQUEST_TIMEOUT_MS)
  });

  if (!response.ok) {
    throw new Error(
      (await extractMicrosoftGraphResponseError(response)) ??
        `Microsoft Graph attachment download failed for ${mailbox} message ${messageId} attachment ${attachmentId} with status ${response.status}.`
    );
  }

  return (await response.json()) as MicrosoftGraphMailFileAttachment;
}

export async function resolveMicrosoftGraphMailboxMessagesPath(accessToken: string, mailbox: string) {
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

  const resolvedUserId = await resolveMicrosoftGraphMailboxUserId(accessToken, mailbox);
  if (!resolvedUserId) {
    throw new Error(
      `${probeError} Microsoft Graph could not resolve ${mailbox} by mail, userPrincipalName, or proxy address. Confirm the mailbox target is configured correctly and the application has permission to read it.`
    );
  }

  return `users/${encodeURIComponent(resolvedUserId)}/messages`;
}

async function fetchMailboxMessagesPage(accessToken: string, mailbox: string, url: string) {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Prefer: 'outlook.body-content-type="text"'
    },
    cache: "no-store",
    signal: AbortSignal.timeout(MICROSOFT_GRAPH_REQUEST_TIMEOUT_MS)
  });

  if (!response.ok) {
    throw new Error(
      (await extractMicrosoftGraphResponseError(response)) ??
        `Microsoft Graph mail sync failed for ${mailbox} with status ${response.status}.`
    );
  }

  const json = (await response.json()) as {
    value?: MicrosoftGraphMailMessage[];
    "@odata.nextLink"?: string;
  };

  return {
    messages: Array.isArray(json.value)
      ? json.value.map((message) => ({
          ...message,
          mailboxAddress: mailbox === "me" ? null : mailbox
        }))
      : [],
    nextLink: json["@odata.nextLink"] ?? null
  };
}

function buildMailboxMessagesUrl(path: string, since: Date, maxMessages: number) {
  const select = "id,subject,bodyPreview,body,webLink,internetMessageId,conversationId,receivedDateTime,hasAttachments,from,toRecipients,ccRecipients";
  const top = Math.min(MICROSOFT_GRAPH_MAIL_PAGE_SIZE, maxMessages);
  const filter = encodeURIComponent(`receivedDateTime ge ${since.toISOString()}`);

  return `https://graph.microsoft.com/v1.0/${path}?$top=${top}&$select=${select}&$orderby=receivedDateTime%20desc&$filter=${filter}`;
}

async function resolveMicrosoftGraphMailboxUserId(accessToken: string, mailbox: string) {
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

function escapeODataString(value: string) {
  return value.replace(/'/g, "''");
}
