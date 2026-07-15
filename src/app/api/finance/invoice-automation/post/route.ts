import { IntegrationProvider, IntegrationStatus, InvoiceAutomationStatus, ModuleKey, PlatformRole, type InvoiceAutomationType, type Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { formatInvoicePostingBlocker, getInvoicePostingBlockingIssues, InvoiceApprovalError } from "@/modules/invoice-automation/approval";
import {
  attachPdfToQuickBooksTransaction,
  buildQuickBooksSalesInvoicePayload,
  buildQuickBooksVendorBillPayload,
  createQuickBooksInvoiceAutomationTransaction,
  fetchQuickBooksExchangeRate,
  fetchQuickBooksPostedTransaction,
  fetchQuickBooksPostingMappings,
  findExistingQuickBooksTransaction,
  parseQuickBooksEntityOptionId,
  QuickBooksPostingMappingError,
  type QuickBooksPostedTransactionDetail,
  type QuickBooksPostingMappings
} from "@/modules/invoice-automation/quickbooks-posting";
import { toInvoiceAutomationRow } from "@/modules/invoice-automation/row-mapper";
import { requireModule, requireMutationAccess, requireRole } from "@/server/auth/authorization";
import { prisma } from "@/server/db";
import {
  decryptQuickBooksSecret,
  encryptQuickBooksSecret,
  refreshQuickBooksAccessToken
} from "@/server/integrations/quickbooks";
import { getAuthenticatedContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

type PostPayload = {
  invoiceIds?: unknown;
  mode?: unknown;
  confirmText?: unknown;
};

type QuickBooksCredentialRecord = {
  id: string;
  tenantId: string;
  name: string;
  publicConfig: Prisma.JsonValue;
  secretRef: string | null;
};

type QuickBooksConnection = {
  credential: QuickBooksCredentialRecord;
  realmId: string;
  accessToken: string;
};

const QUICKBOOKS_HOME_CURRENCY = "CAD";
const QUICKBOOKS_FX_SOURCE = "QUICKBOOKS_POSTED_TRANSACTION";

export async function POST(request: Request) {
  try {
    const context = await getAuthenticatedContext();
    await requireModule(context, ModuleKey.QUICKBOOKS_POSTING);
    await requireMutationAccess(context);
    requireRole(context, [PlatformRole.ADMIN, PlatformRole.MANAGER, PlatformRole.FINANCE]);

    const body = (await request.json().catch(() => null)) as PostPayload | null;
    const invoiceIds = Array.isArray(body?.invoiceIds)
      ? body.invoiceIds.filter((id): id is string => typeof id === "string" && id.length > 0)
      : [];
    const mode = body?.mode === "post" ? "post" : "preview";

    if (invoiceIds.length === 0) {
      return NextResponse.json({ error: "Select at least one approved invoice or posting-error retry." }, { status: 400 });
    }

    if (invoiceIds.length > 25) {
      return NextResponse.json({ error: "Post 25 invoices or fewer at a time." }, { status: 400 });
    }

    if (mode === "post") {
      if (process.env.QUICKBOOKS_POSTING_ENABLED !== "true") {
        return NextResponse.json(
          { error: "QuickBooks posting is disabled. Set QUICKBOOKS_POSTING_ENABLED=true only when ready to run controlled tests." },
          { status: 403 }
        );
      }
      if (body?.confirmText !== "POST TO QUICKBOOKS") {
        return NextResponse.json({ error: "Type POST TO QUICKBOOKS to confirm this test posting run." }, { status: 400 });
      }
    }

    const invoices = await prisma.invoiceAutomationInvoice.findMany({
      where: {
        tenantId: context.tenantId,
        id: { in: invoiceIds },
        status: {
          in: [InvoiceAutomationStatus.APPROVED_FOR_POSTING, InvoiceAutomationStatus.POSTING_ERROR]
        }
      },
      include: {
        batch: {
          select: {
            batchNumber: true
          }
        },
        document: {
          select: {
            fileName: true,
            contentType: true,
            extractedText: true,
            pdfBytes: true
          }
        }
      }
    });

    if (invoices.length !== invoiceIds.length) {
      throw new InvoiceApprovalError("One or more selected invoices are not approved for QuickBooks posting or retry.");
    }

    const credentials = await getQuickBooksCredentials(context.tenantId);
    const connectionByRealm = new Map<string, QuickBooksConnection>();
    const mappingsByRealm = new Map<string, QuickBooksPostingMappings>();
    const exchangeRateByRealmCurrencyDate = new Map<string, number>();
    const results = [];

    for (const invoice of invoices) {
      const row = toInvoiceAutomationRow(invoice);
      const issues = getInvoicePostingBlockingIssues(row);
      if (issues.length > 0) {
        throw new InvoiceApprovalError(formatInvoicePostingBlocker(row, issues));
      }

      try {
        const parsedEntity = parseQuickBooksEntityOptionId(row.quickBooksEntityId, row.invoiceType);
        const connection = await getQuickBooksConnectionForInvoice({
          credentials,
          parsedRealmId: parsedEntity?.realmId ?? null,
          connectionByRealm
        });

        if (invoice.status === InvoiceAutomationStatus.POSTING_ERROR && invoice.quickBooksTxnId) {
          const transaction = {
            id: invoice.quickBooksTxnId,
            docNumber: invoice.quickBooksTxnNumber ?? row.invoiceNumber ?? null
          };

          if (mode === "preview") {
            results.push({
              invoiceId: row.id,
              invoiceType: row.invoiceType,
              invoiceNumber: row.invoiceNumber,
              shipmentFileNumber: row.shipmentFileNumber,
              realmId: connection.realmId,
              quickBooksTxnId: transaction.id,
              quickBooksTxnNumber: transaction.docNumber,
              retryAction: "attach_pdf_to_existing_transaction"
            });
            continue;
          }

          const attachment = await attachPdfToQuickBooksTransaction({
            realmId: connection.realmId,
            accessToken: connection.accessToken,
            invoiceType: row.invoiceType,
            transactionId: transaction.id,
            fileName: invoice.document.fileName,
            contentType: invoice.document.contentType || "application/pdf",
            pdfBytes: invoice.document.pdfBytes
          });
          const attachmentId = readAttachableId(attachment);
          const postedDetail = await safelyFetchPostedTransactionDetail({
            connection,
            row,
            transaction
          });

          await markInvoicePostedToQuickBooks({
            tenantId: context.tenantId,
            userId: context.userId,
            row,
            connection,
            transaction,
            attachmentId,
            postedDetail
          });

          results.push({
            invoiceId: row.id,
            invoiceType: row.invoiceType,
            invoiceNumber: row.invoiceNumber,
            shipmentFileNumber: row.shipmentFileNumber,
            realmId: connection.realmId,
            quickBooksTxnId: transaction.id,
            quickBooksTxnNumber: transaction.docNumber,
            quickBooksAttachmentId: attachmentId,
            quickBooksExchangeRate: postedDetail?.exchangeRate ?? null,
            quickBooksHomeCurrency: postedDetail ? QUICKBOOKS_HOME_CURRENCY : null,
            quickBooksSubtotalHomeAmount: postedDetail?.homeSubtotalAmount ?? null,
            quickBooksTaxHomeAmount: postedDetail?.homeTaxAmount ?? null,
            quickBooksTotalHomeAmount: postedDetail?.homeTotalAmount ?? null,
            retryAction: "attach_pdf_to_existing_transaction",
            posted: true
          });
          continue;
        }

        const mappings = await getMappingsForRealm(connection, mappingsByRealm);
        const exchangeRate = await getExchangeRateForInvoice({
          row,
          connection,
          exchangeRateByRealmCurrencyDate
        });
        const taxContextText = [
          row.fileName,
          invoice.document.fileName,
          invoice.document.extractedText
        ].filter((value): value is string => Boolean(value)).join("\n");
        const payload = row.invoiceType === "CUSTOMER"
          ? buildQuickBooksSalesInvoicePayload(row, mappings, { exchangeRate, taxContextText })
          : buildQuickBooksVendorBillPayload(row, mappings, { exchangeRate, taxContextText });

        if (mode === "preview") {
          results.push({
            invoiceId: row.id,
            invoiceType: row.invoiceType,
            invoiceNumber: row.invoiceNumber,
            shipmentFileNumber: row.shipmentFileNumber,
            realmId: connection.realmId,
            payload
          });
          continue;
        }

        if (!row.invoiceNumber) {
          throw new QuickBooksPostingMappingError("Missing invoice number for QuickBooks duplicate check.");
        }

        const existingTransaction = await findExistingQuickBooksTransaction({
          realmId: connection.realmId,
          accessToken: connection.accessToken,
          invoiceType: row.invoiceType,
          docNumber: row.invoiceNumber,
          quickBooksEntityId: parsedEntity?.quickBooksId ?? null
        });

        if (existingTransaction?.Id) {
          throw new QuickBooksPostingMappingError(
            `QuickBooks already has a ${row.invoiceType === "CUSTOMER" ? "customer invoice" : "vendor bill"} for ${row.quickBooksEntityDisplayName ?? row.entityNameRaw ?? "the selected QuickBooks profile"} with document number ${row.invoiceNumber}.`
          );
        }

        const posted = await createQuickBooksInvoiceAutomationTransaction({
          realmId: connection.realmId,
          accessToken: connection.accessToken,
          invoiceType: row.invoiceType,
          payload
        });
        const transaction = readPostedTransaction(posted, row.invoiceType);
        let attachmentId: string | null = null;

        try {
          const attachment = await attachPdfToQuickBooksTransaction({
            realmId: connection.realmId,
            accessToken: connection.accessToken,
            invoiceType: row.invoiceType,
            transactionId: transaction.id,
            fileName: invoice.document.fileName,
            contentType: invoice.document.contentType || "application/pdf",
            pdfBytes: invoice.document.pdfBytes
          });
          attachmentId = readAttachableId(attachment);
        } catch (attachmentError) {
          const message = attachmentError instanceof Error ? attachmentError.message : "Unable to attach PDF to QuickBooks transaction.";
          await prisma.invoiceAutomationInvoice.update({
            where: {
              tenantId_id: {
                tenantId: context.tenantId,
                id: row.id
              }
            },
            data: {
              status: InvoiceAutomationStatus.POSTING_ERROR,
              postedByUserId: context.userId,
              postedAt: new Date(),
              quickBooksTxnId: transaction.id,
              quickBooksTxnNumber: transaction.docNumber,
              quickBooksPostingError: `QuickBooks transaction was created, but the PDF attachment failed: ${message}`
            }
          });
          results.push({
            invoiceId: row.id,
            invoiceType: row.invoiceType,
            invoiceNumber: row.invoiceNumber,
            shipmentFileNumber: row.shipmentFileNumber,
            realmId: connection.realmId,
            quickBooksTxnId: transaction.id,
            quickBooksTxnNumber: transaction.docNumber,
            error: `QuickBooks transaction was created, but the PDF attachment failed: ${message}`
          });
          continue;
        }

        const postedDetail = await safelyFetchPostedTransactionDetail({
          connection,
          row,
          transaction
        });

        await markInvoicePostedToQuickBooks({
          tenantId: context.tenantId,
          userId: context.userId,
          row,
          connection,
          transaction,
          attachmentId,
          postedDetail
        });

        results.push({
          invoiceId: row.id,
          invoiceType: row.invoiceType,
          invoiceNumber: row.invoiceNumber,
          shipmentFileNumber: row.shipmentFileNumber,
          realmId: connection.realmId,
          quickBooksTxnId: transaction.id,
          quickBooksTxnNumber: transaction.docNumber,
          quickBooksAttachmentId: attachmentId,
          quickBooksExchangeRate: postedDetail?.exchangeRate ?? null,
          quickBooksHomeCurrency: postedDetail ? QUICKBOOKS_HOME_CURRENCY : null,
          quickBooksSubtotalHomeAmount: postedDetail?.homeSubtotalAmount ?? null,
          quickBooksTaxHomeAmount: postedDetail?.homeTaxAmount ?? null,
          quickBooksTotalHomeAmount: postedDetail?.homeTotalAmount ?? null,
          posted: true
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unable to post invoice to QuickBooks.";
        if (mode === "post") {
          await prisma.invoiceAutomationInvoice.update({
            where: {
              tenantId_id: {
                tenantId: context.tenantId,
                id: row.id
              }
            },
            data: {
              status: InvoiceAutomationStatus.POSTING_ERROR,
              quickBooksPostingError: message
            }
          });
        }
        results.push({
          invoiceId: row.id,
          invoiceType: row.invoiceType,
          invoiceNumber: row.invoiceNumber,
          shipmentFileNumber: row.shipmentFileNumber,
          error: message
        });
      }
    }

    if (mode === "post") {
      revalidateInvoiceAutomation();
    }

    const errorCount = results.filter((result) => "error" in result).length;
    return NextResponse.json(
      {
        mode,
        posted: mode === "post",
        results,
        errorCount
      },
      { status: errorCount > 0 ? 207 : 200 }
    );
  } catch (error) {
    console.error(error);
    if (error instanceof InvoiceApprovalError || error instanceof QuickBooksPostingMappingError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to prepare QuickBooks posting." },
      { status: 500 }
    );
  }
}

function readAttachableId(response: Awaited<ReturnType<typeof attachPdfToQuickBooksTransaction>>) {
  return response.AttachableResponse
    ?.map((row) => row.Attachable?.Id)
    .find((id): id is string => Boolean(id)) ?? null;
}

async function markInvoicePostedToQuickBooks({
  tenantId,
  userId,
  row,
  connection,
  transaction,
  attachmentId,
  postedDetail
}: {
  tenantId: string;
  userId: string;
  row: ReturnType<typeof toInvoiceAutomationRow>;
  connection: QuickBooksConnection;
  transaction: { id: string; docNumber: string | null };
  attachmentId: string | null;
  postedDetail: QuickBooksPostedTransactionDetail | null;
}) {
  await prisma.invoiceAutomationInvoice.update({
    where: {
      tenantId_id: {
        tenantId,
        id: row.id
      }
    },
    data: {
      status: InvoiceAutomationStatus.POSTED,
      postedByUserId: userId,
      postedAt: new Date(),
      quickBooksTxnId: transaction.id,
      quickBooksTxnNumber: postedDetail?.docNumber ?? transaction.docNumber,
      quickBooksExchangeRate: postedDetail?.exchangeRate ?? null,
      quickBooksHomeCurrency: postedDetail ? QUICKBOOKS_HOME_CURRENCY : null,
      quickBooksSubtotalHomeAmount: postedDetail?.homeSubtotalAmount ?? null,
      quickBooksTaxHomeAmount: postedDetail?.homeTaxAmount ?? null,
      quickBooksTotalHomeAmount: postedDetail?.homeTotalAmount ?? null,
      quickBooksFxSource: postedDetail ? QUICKBOOKS_FX_SOURCE : null,
      quickBooksFxCapturedAt: postedDetail ? new Date() : null,
      quickBooksPostingError: null
    }
  });

  await prisma.auditLog.create({
    data: {
      tenantId,
      actorUserId: userId,
      action: "invoice-automation.posted-to-quickbooks",
      entityType: "InvoiceAutomationInvoice",
      entityId: row.id,
      after: {
        invoiceType: row.invoiceType,
        invoiceNumber: row.invoiceNumber,
        quickBooksTxnId: transaction.id,
        quickBooksTxnNumber: postedDetail?.docNumber ?? transaction.docNumber,
        quickBooksAttachmentId: attachmentId,
        quickBooksExchangeRate: postedDetail?.exchangeRate ?? null,
        quickBooksHomeCurrency: postedDetail ? QUICKBOOKS_HOME_CURRENCY : null,
        quickBooksSubtotalHomeAmount: postedDetail?.homeSubtotalAmount ?? null,
        quickBooksTaxHomeAmount: postedDetail?.homeTaxAmount ?? null,
        quickBooksTotalHomeAmount: postedDetail?.homeTotalAmount ?? null,
        realmId: connection.realmId
      }
    }
  });
}

async function safelyFetchPostedTransactionDetail({
  connection,
  row,
  transaction
}: {
  connection: QuickBooksConnection;
  row: ReturnType<typeof toInvoiceAutomationRow>;
  transaction: { id: string; docNumber: string | null };
}) {
  try {
    return await fetchQuickBooksPostedTransaction({
      realmId: connection.realmId,
      accessToken: connection.accessToken,
      invoiceType: row.invoiceType,
      transactionId: transaction.id
    });
  } catch (error) {
    console.warn(
      "Unable to fetch posted QuickBooks transaction amounts.",
      {
        invoiceId: row.id,
        invoiceType: row.invoiceType,
        quickBooksTxnId: transaction.id,
        error: error instanceof Error ? error.message : error
      }
    );
    return null;
  }
}

async function getQuickBooksCredentials(tenantId: string) {
  const credentials = await prisma.integrationCredential.findMany({
    where: {
      tenantId,
      provider: IntegrationProvider.QUICKBOOKS,
      status: IntegrationStatus.ACTIVE,
      secretRef: {
        not: null
      }
    },
    select: {
      id: true,
      tenantId: true,
      name: true,
      publicConfig: true,
      secretRef: true
    }
  });

  if (credentials.length === 0) {
    throw new QuickBooksPostingMappingError("No active QuickBooks connection is available for this tenant.");
  }

  return credentials;
}

async function getQuickBooksConnectionForInvoice({
  credentials,
  parsedRealmId,
  connectionByRealm
}: {
  credentials: QuickBooksCredentialRecord[];
  parsedRealmId: string | null;
  connectionByRealm: Map<string, QuickBooksConnection>;
}) {
  const credential = resolveQuickBooksCredential(credentials, parsedRealmId);
  const config = readQuickBooksPublicConfig(credential.publicConfig);
  if (!config.realmId) {
    throw new QuickBooksPostingMappingError(`${credential.name} is missing a QuickBooks realm ID.`);
  }

  const cached = connectionByRealm.get(config.realmId);
  if (cached) {
    return cached;
  }

  const accessToken = await getUsableQuickBooksAccessToken(credential, config);
  const connection = {
    credential,
    realmId: config.realmId,
    accessToken
  };
  connectionByRealm.set(config.realmId, connection);
  return connection;
}

function resolveQuickBooksCredential(credentials: QuickBooksCredentialRecord[], parsedRealmId: string | null) {
  if (parsedRealmId) {
    const credential = credentials.find((candidate) => readQuickBooksPublicConfig(candidate.publicConfig).realmId === parsedRealmId);
    if (!credential) {
      throw new QuickBooksPostingMappingError(`No active QuickBooks connection was found for realm ${parsedRealmId}.`);
    }
    return credential;
  }

  if (credentials.length === 1) {
    return credentials[0];
  }

  throw new QuickBooksPostingMappingError("The selected QuickBooks entity is missing its realm. Re-select the customer/vendor from the QuickBooks dropdown.");
}

async function getMappingsForRealm(
  connection: QuickBooksConnection,
  mappingsByRealm: Map<string, QuickBooksPostingMappings>
) {
  const cached = mappingsByRealm.get(connection.realmId);
  if (cached) {
    return cached;
  }

  const mappings = await fetchQuickBooksPostingMappings({
    realmId: connection.realmId,
    accessToken: connection.accessToken
  });
  mappingsByRealm.set(connection.realmId, mappings);
  return mappings;
}

async function getExchangeRateForInvoice({
  row,
  connection,
  exchangeRateByRealmCurrencyDate
}: {
  row: ReturnType<typeof toInvoiceAutomationRow>;
  connection: QuickBooksConnection;
  exchangeRateByRealmCurrencyDate: Map<string, number>;
}) {
  const currency = row.currency?.trim().toUpperCase();
  if (!currency || currency === "CAD") {
    return null;
  }

  const asOfDate = row.invoiceDate ?? new Date().toISOString().slice(0, 10);
  const cacheKey = `${connection.realmId}:${currency}:${asOfDate}`;
  const cached = exchangeRateByRealmCurrencyDate.get(cacheKey);
  if (cached) {
    return cached;
  }

  const rate = await fetchQuickBooksExchangeRate({
    realmId: connection.realmId,
    accessToken: connection.accessToken,
    sourceCurrencyCode: currency,
    asOfDate
  });
  exchangeRateByRealmCurrencyDate.set(cacheKey, rate);
  return rate;
}

async function getUsableQuickBooksAccessToken(
  credential: QuickBooksCredentialRecord,
  config: ReturnType<typeof readQuickBooksPublicConfig>
) {
  if (!credential.secretRef) {
    throw new QuickBooksPostingMappingError("QuickBooks credential is missing encrypted OAuth tokens.");
  }
  if (!config.realmId) {
    throw new QuickBooksPostingMappingError("QuickBooks credential is missing a realm ID.");
  }

  const secret = decryptQuickBooksSecret(credential.secretRef);
  const expiresAt = config.accessTokenExpiresAt ? new Date(config.accessTokenExpiresAt).getTime() : 0;
  if (secret.accessToken && expiresAt - Date.now() > 120000) {
    return secret.accessToken;
  }

  if (!secret.refreshToken) {
    throw new QuickBooksPostingMappingError("QuickBooks credential is missing a refresh token.");
  }

  const refreshed = await refreshQuickBooksAccessToken({ refreshToken: secret.refreshToken });
  await prisma.integrationCredential.update({
    where: {
      id: credential.id
    },
    data: {
      publicConfig: {
        ...config.raw,
        accessTokenExpiresAt: refreshed.accessTokenExpiresAt,
        refreshTokenExpiresAt: refreshed.refreshTokenExpiresAt
      },
      secretRef: encryptQuickBooksSecret({
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken,
        tokenType: refreshed.tokenType,
        realmId: config.realmId
      })
    }
  });

  return refreshed.accessToken;
}

function readQuickBooksPublicConfig(value: Prisma.JsonValue) {
  const raw = value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

  return {
    raw,
    realmId: typeof raw.realmId === "string" ? raw.realmId : null,
    accessTokenExpiresAt: typeof raw.accessTokenExpiresAt === "string" ? raw.accessTokenExpiresAt : null
  };
}

function readPostedTransaction(
  response: Awaited<ReturnType<typeof createQuickBooksInvoiceAutomationTransaction>>,
  invoiceType: InvoiceAutomationType
) {
  const transaction = invoiceType === "CUSTOMER" ? response.Invoice : response.Bill;
  if (!transaction?.Id) {
    throw new QuickBooksPostingMappingError("QuickBooks did not return a transaction ID.");
  }

  return {
    id: transaction.Id,
    docNumber: transaction.DocNumber ?? null
  };
}

function revalidateInvoiceAutomation() {
  revalidatePath("/finance/invoice-automation");
  revalidatePath("/finance/invoice-automation/accounting");
  revalidatePath("/finance/invoice-automation/posted");
  revalidatePath("/finance/invoice-automation/reconciliation");
}
