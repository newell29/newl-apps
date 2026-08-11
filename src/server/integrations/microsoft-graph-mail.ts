import { createHash, randomUUID } from "node:crypto";

const MICROSOFT_GRAPH_REQUEST_TIMEOUT_MS = 45_000;
const MICROSOFT_GRAPH_MAIL_PAGE_SIZE = 50;
const MICROSOFT_GRAPH_READ_MAX_ATTEMPTS = 3;
const MICROSOFT_GRAPH_READ_RETRY_DELAYS_MS = [250, 1_000] as const;

type MicrosoftGraphReadOutcome =
  | "success"
  | "retry_scheduled"
  | "recovered"
  | "exhausted"
  | "permanent_failure";

type MicrosoftGraphReadDiagnostics = {
  outcome: MicrosoftGraphReadOutcome;
  attemptedAt: string;
  attempt: number;
  maxAttempts: number;
  status: number | null;
  graphRequestId: string | null;
  clientRequestId: string;
  resourceFingerprint: string;
};

const microsoftGraphReadDiagnostics = new WeakMap<Response, MicrosoftGraphReadDiagnostics>();

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

export type MicrosoftGraphOutboundMessage = {
  recipientEmail: string;
  recipientName?: string | null;
  subject: string;
  body: string;
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

export async function fetchMicrosoftGraphMailboxFolderMessages(
  accessToken: string,
  mailbox: string,
  folderPath: string,
  options: MicrosoftGraphMailFetchOptions
) {
  const messagePath = await resolveMicrosoftGraphMailboxFolderMessagesPath(
    accessToken,
    mailbox,
    folderPath
  );
  const since = new Date(Date.now() - options.lookbackDays * 24 * 60 * 60 * 1000);
  const messages: MicrosoftGraphMailMessage[] = [];
  let nextUrl: string | null = buildMailboxMessagesUrl(
    messagePath,
    since,
    options.maxMessagesPerMailbox,
    "id,subject,receivedDateTime,hasAttachments,from"
  );

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
  const response = await fetchMicrosoftGraphReadWithRetry(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store"
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
  const url = `https://graph.microsoft.com/v1.0/${messagePath}/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(
    attachmentId
  )}/$value`;
  const response = await fetchMicrosoftGraphReadWithRetry(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(
      (await extractMicrosoftGraphResponseError(response)) ??
        `Microsoft Graph attachment download failed for ${mailbox} message ${messageId} attachment ${attachmentId} with status ${response.status}.`
    );
  }

  return {
    id: attachmentId,
    contentBytes: Buffer.from(await response.arrayBuffer()).toString("base64")
  } satisfies MicrosoftGraphMailFileAttachment;
}

export async function createAndSendMicrosoftGraphMailboxMessage(
  accessToken: string,
  mailbox: string,
  message: MicrosoftGraphOutboundMessage
) {
  const sendPath =
    mailbox === "me"
      ? "me/sendMail"
      : `users/${encodeURIComponent(mailbox)}/sendMail`;
  const sendResponse = await fetch(`https://graph.microsoft.com/v1.0/${sendPath}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      message: {
        subject: message.subject,
        body: {
          contentType: "Text",
          content: message.body
        },
        toRecipients: [{
          emailAddress: {
            address: message.recipientEmail,
            ...(message.recipientName ? { name: message.recipientName } : {})
          }
        }]
      },
      saveToSentItems: true
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(MICROSOFT_GRAPH_REQUEST_TIMEOUT_MS)
  });

  if (!sendResponse.ok) {
    throw new Error(
      (await extractMicrosoftGraphResponseError(sendResponse)) ??
        `Microsoft Graph message send failed for ${mailbox} with status ${sendResponse.status}.`
    );
  }

  return {
    id: null,
    conversationId: null,
    internetMessageId: null
  };
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

export async function resolveMicrosoftGraphMailboxFolderMessagesPath(
  accessToken: string,
  mailbox: string,
  folderPath: string
) {
  const segments = folderPath
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (segments.length === 0) {
    throw new Error("Microsoft Graph mail folder path cannot be empty.");
  }

  const mailboxMessagesPath =
    mailbox === "me"
      ? "me/messages"
      : await resolveMicrosoftGraphMailboxMessagesPath(accessToken, mailbox);
  const mailboxRoot = mailboxMessagesPath.replace(/\/messages$/, "");
  let folderResourcePath: string;
  const firstSegment = segments[0]!;

  if (firstSegment.toLowerCase() === "inbox") {
    folderResourcePath = `${mailboxRoot}/mailFolders/inbox`;
  } else {
    const rootFolder = await findMicrosoftGraphMailFolder(
      accessToken,
      `${mailboxRoot}/mailFolders`,
      firstSegment
    );
    folderResourcePath = `${mailboxRoot}/mailFolders/${encodeURIComponent(rootFolder.id)}`;
  }

  for (const segment of segments.slice(1)) {
    const child = await findMicrosoftGraphMailFolder(
      accessToken,
      `${folderResourcePath}/childFolders`,
      segment
    );
    folderResourcePath = `${mailboxRoot}/mailFolders/${encodeURIComponent(child.id)}`;
  }

  return `${folderResourcePath}/messages`;
}

async function findMicrosoftGraphMailFolder(
  accessToken: string,
  collectionPath: string,
  displayName: string
) {
  const url = `https://graph.microsoft.com/v1.0/${collectionPath}?$top=50&$select=id,displayName`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
    signal: AbortSignal.timeout(MICROSOFT_GRAPH_REQUEST_TIMEOUT_MS)
  });

  if (!response.ok) {
    throw new Error(
      (await extractMicrosoftGraphResponseError(response)) ??
        `Microsoft Graph folder lookup failed for ${displayName} with status ${response.status}.`
    );
  }

  const json = (await response.json()) as {
    value?: Array<{ id?: string | null; displayName?: string | null }>;
  };
  const matches = (json.value ?? []).filter(
    (folder) =>
      Boolean(folder.id) &&
      folder.displayName?.trim().toLowerCase() === displayName.trim().toLowerCase()
  );
  if (matches.length !== 1 || !matches[0]?.id) {
    throw new Error(
      matches.length > 1
        ? `Microsoft Graph found more than one ${displayName} mail folder. Rename the duplicate folders before Scout imports reports.`
        : `Microsoft Graph could not find the ${displayName} mail folder.`
    );
  }

  return { id: matches[0].id, displayName: matches[0].displayName ?? displayName };
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

function buildMailboxMessagesUrl(
  path: string,
  since: Date,
  maxMessages: number,
  select = "id,subject,bodyPreview,body,webLink,internetMessageId,conversationId,receivedDateTime,hasAttachments,from,toRecipients,ccRecipients"
) {
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

  const diagnostics = microsoftGraphReadDiagnostics.get(response);
  const diagnosticSuffix = diagnostics ? ` ${formatMicrosoftGraphReadDiagnostics(diagnostics)}` : "";

  if (!code && !message) return diagnostics ? `Microsoft Graph request failed with status ${response.status}.${diagnosticSuffix}` : null;

  return `Microsoft Graph request failed with status ${response.status}${code ? ` (${code})` : ""}${message ? `: ${message}` : ""}.${diagnosticSuffix}`;
}

async function fetchMicrosoftGraphReadWithRetry(url: string, init: RequestInit) {
  let lastError: unknown = null;
  const clientRequestId = randomUUID();
  const resourceFingerprint = createHash("sha256").update(new URL(url).pathname).digest("hex").slice(0, 16);

  for (let attempt = 0; attempt < MICROSOFT_GRAPH_READ_MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...init,
        headers: {
          ...readMicrosoftGraphHeaders(init.headers),
          "client-request-id": clientRequestId,
          "return-client-request-id": "true"
        },
        signal: AbortSignal.timeout(MICROSOFT_GRAPH_REQUEST_TIMEOUT_MS)
      });
      const canRetry =
        attempt < MICROSOFT_GRAPH_READ_MAX_ATTEMPTS - 1 &&
        isRetryableMicrosoftGraphReadStatus(response.status);
      const diagnostics = buildMicrosoftGraphReadDiagnostics({
        outcome: response.ok
          ? attempt > 0
            ? "recovered"
            : "success"
          : canRetry
            ? "retry_scheduled"
            : isRetryableMicrosoftGraphReadStatus(response.status)
              ? "exhausted"
              : "permanent_failure",
        attempt,
        response,
        clientRequestId,
        resourceFingerprint
      });

      if (!canRetry) {
        microsoftGraphReadDiagnostics.set(response, diagnostics);
        if (diagnostics.outcome === "recovered") {
          console.info("Microsoft Graph read recovered after a transient failure.", diagnostics);
        } else if (diagnostics.outcome !== "success") {
          console.warn("Microsoft Graph read did not succeed.", diagnostics);
        }
        return response;
      }

      console.warn("Microsoft Graph read will retry a transient failure.", diagnostics);
      const retryDelayMs = resolveMicrosoftGraphRetryDelayMs(
        response,
        MICROSOFT_GRAPH_READ_RETRY_DELAYS_MS[attempt] ?? 1_000
      );
      await response.body?.cancel().catch(() => undefined);
      await waitForMicrosoftGraphRetry(retryDelayMs);
    } catch (error) {
      lastError = error;
      const canRetry =
        attempt < MICROSOFT_GRAPH_READ_MAX_ATTEMPTS - 1 &&
        isRetryableMicrosoftGraphReadError(error);
      const diagnostics: MicrosoftGraphReadDiagnostics = {
        outcome: canRetry ? "retry_scheduled" : "exhausted",
        attemptedAt: new Date().toISOString(),
        attempt: attempt + 1,
        maxAttempts: MICROSOFT_GRAPH_READ_MAX_ATTEMPTS,
        status: null,
        graphRequestId: null,
        clientRequestId,
        resourceFingerprint
      };

      if (!canRetry) {
        console.warn("Microsoft Graph read transport failure was not recovered.", diagnostics);
        throw new Error(
          `${error instanceof Error ? error.message : "Microsoft Graph transport failure."} ${formatMicrosoftGraphReadDiagnostics(diagnostics)}`,
          { cause: error }
        );
      }

      console.warn("Microsoft Graph read will retry a transient transport failure.", diagnostics);
      await waitForMicrosoftGraphRetry(
        MICROSOFT_GRAPH_READ_RETRY_DELAYS_MS[attempt] ?? 1_000
      );
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Microsoft Graph read failed after bounded retry.");
}

function readMicrosoftGraphHeaders(headers: HeadersInit | undefined) {
  return Object.fromEntries(new Headers(headers).entries());
}

function buildMicrosoftGraphReadDiagnostics({
  outcome,
  attempt,
  response,
  clientRequestId,
  resourceFingerprint
}: {
  outcome: MicrosoftGraphReadOutcome;
  attempt: number;
  response: Response;
  clientRequestId: string;
  resourceFingerprint: string;
}): MicrosoftGraphReadDiagnostics {
  return {
    outcome,
    attemptedAt: new Date().toISOString(),
    attempt: attempt + 1,
    maxAttempts: MICROSOFT_GRAPH_READ_MAX_ATTEMPTS,
    status: response.status,
    graphRequestId: response.headers?.get("request-id") ?? null,
    clientRequestId,
    resourceFingerprint
  };
}

function formatMicrosoftGraphReadDiagnostics(diagnostics: MicrosoftGraphReadDiagnostics) {
  return `[Graph diagnostics: outcome=${diagnostics.outcome}; attempt=${diagnostics.attempt}/${diagnostics.maxAttempts}; requestId=${diagnostics.graphRequestId ?? "unavailable"}; clientRequestId=${diagnostics.clientRequestId}; resource=${diagnostics.resourceFingerprint}; at=${diagnostics.attemptedAt}]`;
}

function isRetryableMicrosoftGraphReadStatus(status: number) {
  return status === 408 || status === 429 || status >= 500;
}

function isRetryableMicrosoftGraphReadError(error: unknown) {
  if (error instanceof TypeError) return true;
  if (typeof DOMException !== "undefined" && error instanceof DOMException) {
    return error.name === "AbortError" || error.name === "TimeoutError";
  }
  return false;
}

function resolveMicrosoftGraphRetryDelayMs(response: Response, fallbackMs: number) {
  const retryAfter = response.headers.get("retry-after");
  if (!retryAfter) return fallbackMs;

  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1_000, 5_000);
  }

  const retryAt = new Date(retryAfter);
  if (Number.isNaN(retryAt.getTime())) return fallbackMs;
  return Math.min(Math.max(0, retryAt.getTime() - Date.now()), 5_000);
}

async function waitForMicrosoftGraphRetry(delayMs: number) {
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}

function escapeODataString(value: string) {
  return value.replace(/'/g, "''");
}
