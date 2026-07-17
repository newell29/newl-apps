import type {
  GarlandPdfShippingOrder,
  GarlandShippingOrderItem,
  GarlandTeamshipOrderReview,
  GarlandTeamshipReviewResponse
} from "@/modules/shipment-documents/teamship-review-types";
import { prisma } from "@/server/db";
import {
  searchTeamshipProductsForShipping,
  type TeamshipShippingProductSearchRow
} from "@/server/integrations/teamship";
import { parseEmailRecipients, sendResendEmail } from "@/server/email/resend";
import type { TenantContext } from "@/server/tenant-context";

const REVIEW_WORKFLOW_KEY = "GARLAND_TEAMSHIP_REVIEW";
const UPDATE_WORKFLOW_KEY = "GARLAND_TEAMSHIP_PHASE2_UPDATE";

export type GarlandCsrAgentReport = {
  runId: string;
  documentLabel: string;
  shipmentDate: string;
  sourcePdfFileName: string | null;
  generatedAt: string;
  generatedByName: string | null;
  summary: {
    pdfOrderCount: number;
    teamshipMatchedCount: number;
    updatedCount: number;
    needsReviewCount: number;
    missingTeamshipCount: number;
    pendingTeamshipCount: number;
    noPdfCount: number;
  };
  completedUpdates: GarlandCsrAgentOrderLine[];
  needsReview: GarlandCsrAgentIssueLine[];
  missingTeamshipOrders: GarlandCsrAgentMissingOrder[];
  noPdfOrders: GarlandCsrAgentOrderLine[];
  orderTable: GarlandCsrAgentOrderTableRow[];
  nextSteps: string[];
  inventoryLookup: {
    checked: boolean;
    skippedReason: string | null;
  };
  subject: string;
  text: string;
  html: string;
};

export type GarlandCsrAgentReportContext = Pick<TenantContext, "tenantId"> & {
  userName?: string | null;
  userEmail?: string | null;
};

type SendGarlandCsrAgentReportEmailInput = {
  to?: string | string[];
};

export type SendGarlandCsrAgentReportEmailResult = {
  report: GarlandCsrAgentReport;
  email: Awaited<ReturnType<typeof sendResendEmail>>;
};

type GarlandCsrAgentOrderLine = {
  psNumber: string;
  srNumber: string;
  teamshipOrderId: string | null;
  teamshipUrl: string | null;
  status: string;
  note: string;
  actions: string[];
};

type GarlandCsrAgentIssueLine = GarlandCsrAgentOrderLine & {
  issues: string[];
};

type GarlandCsrAgentMissingOrder = GarlandCsrAgentOrderLine & {
  inventoryItems: GarlandCsrAgentInventoryItem[];
};

type GarlandCsrAgentInventoryItem = {
  sku: string;
  requestedSerials: string[];
  requestedQuantity: number | null;
  status:
    | "EXACT_SKU_SERIAL_AVAILABLE"
    | "SKU_AVAILABLE_SERIAL_MISSING"
    | "SKU_AVAILABLE"
    | "SKU_NOT_AVAILABLE"
    | "QUARANTINED_STOCK_AVAILABLE"
    | "UNKNOWN";
  note: string;
  alternativeSerials: string[];
};

type GarlandCsrAgentOrderTableRow = {
  tone: "green" | "yellow" | "red" | "gray";
  statusLabel: string;
  psNumber: string;
  srNumber: string;
  teamshipOrderId: string | null;
  teamshipUrl: string | null;
  botChanges: string[];
  matchIssues: string[];
  inventorySummary: string[];
};

type UpdateJobForReport = {
  id: string;
  status: string;
  agentMode: string;
  orders: Array<{
    srNumber: string;
    status: string;
    plannedFieldUpdates: unknown;
    plannedPalletRows: unknown;
    validationIssues: unknown;
    errorMessage: string | null;
  }>;
};

type ReviewRunForReport = {
  id: string;
  documentLabel: string;
  shipmentDate: Date;
  sourcePdfFileName: string | null;
  pdfOrderCount: number;
  teamshipMatchedCount: number;
  failedCount: number;
  missingTeamshipCount: number;
  pendingTeamshipCount: number;
  noPdfCount: number;
  reviewResponse: unknown;
};

export async function buildGarlandCsrAgentReport(
  context: GarlandCsrAgentReportContext,
  runId: string
): Promise<GarlandCsrAgentReport> {
  const run = await prisma.teamshipReviewRun.findFirst({
    where: {
      id: runId,
      tenantId: context.tenantId,
      workflowKey: REVIEW_WORKFLOW_KEY,
      deletedAt: null
    },
    select: {
      id: true,
      documentLabel: true,
      shipmentDate: true,
      sourcePdfFileName: true,
      pdfOrderCount: true,
      teamshipMatchedCount: true,
      failedCount: true,
      missingTeamshipCount: true,
      pendingTeamshipCount: true,
      noPdfCount: true,
      reviewResponse: true
    }
  });

  if (!run) {
    throw new Error("Teamship review run was not found or was already deleted.");
  }

  const review = readReviewResponse(run.reviewResponse);
  const updateJobs = await loadRelatedUpdateJobs(context.tenantId, run);
  const updateOrdersBySr = indexUpdateOrdersBySr(updateJobs);
  const inventoryConfig = readInventoryLookupConfig();
  const inventoryLookup = {
    checked: Boolean(inventoryConfig),
    skippedReason: inventoryConfig
      ? null
      : "Inventory lookup skipped because GARLAND_TEAMSHIP_INVENTORY_USER_ID and GARLAND_TEAMSHIP_INVENTORY_LOCATION_ID are not configured."
  };

  const missingReviews = review.reviews.filter((order) => order.status === "MISSING_TEAMSHIP" || order.status === "PENDING_TEAMSHIP");
  const missingTeamshipOrders = await Promise.all(
    missingReviews.map((order) => buildMissingOrderLine(context, order, review.pdfOrders, inventoryConfig))
  );
  const completedUpdates = review.reviews
    .map((order) => {
      const updateOrder = updateOrdersBySr.get(normalizeIdentifier(order.srNumber));
      return updateOrder?.status === "SUCCESS"
        ? buildOrderLine(order, "Updated in Teamship and marked successful by the update agent.", summarizeUpdateActions(updateOrder))
        : null;
    })
    .filter((order): order is GarlandCsrAgentOrderLine => Boolean(order));
  const needsReview = review.reviews
    .filter((order) => order.status === "FAIL" || updateOrdersBySr.get(normalizeIdentifier(order.srNumber))?.status === "FAILED")
    .map((order) => buildIssueLine(order, updateOrdersBySr.get(normalizeIdentifier(order.srNumber))));
  const noPdfOrders = review.reviews
    .filter((order) => order.status === "NO_PDF")
    .map((order) => buildOrderLine(order, "Teamship order exists, but this run did not include a matching Garland PDF."));
  const summary = {
    pdfOrderCount: review.summary.pdfOrderCount,
    teamshipMatchedCount: review.summary.teamshipMatchedCount,
    updatedCount: completedUpdates.length,
    needsReviewCount: needsReview.length,
    missingTeamshipCount: run.missingTeamshipCount,
    pendingTeamshipCount: run.pendingTeamshipCount,
    noPdfCount: run.noPdfCount
  };
  const subject = buildReportSubject(run, summary);
  const orderTable = buildOrderTable({
    review,
    updateOrdersBySr,
    missingTeamshipOrders
  });
  const nextSteps = buildNextSteps(summary, orderTable);
  const reportBase = {
    runId: run.id,
    documentLabel: run.documentLabel,
    shipmentDate: formatInputDate(run.shipmentDate),
    sourcePdfFileName: run.sourcePdfFileName,
    generatedAt: new Date().toISOString(),
    generatedByName: context.userName ?? context.userEmail ?? null,
    summary,
    completedUpdates,
    needsReview,
    missingTeamshipOrders,
    noPdfOrders,
    orderTable,
    nextSteps,
    inventoryLookup,
    subject
  };
  const text = renderReportText(reportBase);
  const html = renderReportHtml(reportBase);

  return {
    ...reportBase,
    text,
    html
  };
}

export async function sendGarlandCsrAgentReportEmail(
  context: GarlandCsrAgentReportContext,
  runId: string,
  input: SendGarlandCsrAgentReportEmailInput = {}
): Promise<SendGarlandCsrAgentReportEmailResult> {
  const report = await buildGarlandCsrAgentReport(context, runId);
  const email = await sendResendEmail({
    from: resolveEmailFrom(),
    to: resolveRecipients(input.to),
    replyTo: resolveReplyTo(),
    subject: report.subject,
    text: report.text,
    html: report.html
  });

  return { report, email };
}

async function loadRelatedUpdateJobs(tenantId: string, run: ReviewRunForReport): Promise<UpdateJobForReport[]> {
  const start = new Date(run.shipmentDate);
  const end = new Date(run.shipmentDate);
  end.setUTCHours(23, 59, 59, 999);

  return prisma.teamshipUpdateJob.findMany({
    where: {
      tenantId,
      workflowKey: UPDATE_WORKFLOW_KEY,
      shipmentDate: {
        gte: start,
        lte: end
      },
      OR: [
        { sourcePdfFileName: run.sourcePdfFileName },
        { documentLabel: run.documentLabel }
      ]
    },
    orderBy: [{ createdAt: "desc" }],
    take: 10,
    select: {
      id: true,
      status: true,
      agentMode: true,
      orders: {
        select: {
          srNumber: true,
          status: true,
          plannedFieldUpdates: true,
          plannedPalletRows: true,
          validationIssues: true,
          errorMessage: true
        }
      }
    }
  });
}

function indexUpdateOrdersBySr(updateJobs: UpdateJobForReport[]) {
  const index = new Map<string, UpdateJobForReport["orders"][number]>();

  for (const job of updateJobs) {
    for (const order of job.orders) {
      const key = normalizeIdentifier(order.srNumber);
      if (key && !index.has(key)) {
        index.set(key, order);
      }
    }
  }

  return index;
}

async function buildMissingOrderLine(
  context: GarlandCsrAgentReportContext,
  order: GarlandTeamshipOrderReview,
  pdfOrders: GarlandPdfShippingOrder[],
  inventoryConfig: ReturnType<typeof readInventoryLookupConfig>
): Promise<GarlandCsrAgentMissingOrder> {
  const pdfOrder = pdfOrders.find((candidate) => normalizeIdentifier(candidate.srNumber) === normalizeIdentifier(order.srNumber));
  const inventoryItems = inventoryConfig
    ? await Promise.all((pdfOrder?.items ?? []).map((item) => lookupInventoryItem(context, item, inventoryConfig)))
    : (pdfOrder?.items ?? []).map((item) => ({
        sku: item.sku,
        requestedSerials: item.serialNumbers,
        requestedQuantity: item.quantity,
        status: "UNKNOWN" as const,
        note: "Inventory lookup was not configured for this tenant.",
        alternativeSerials: []
      }));

  return {
    ...buildOrderLine(order, order.status === "PENDING_TEAMSHIP" ? "Teamship alert says this order is pending creation." : "No matching Teamship order was found."),
    inventoryItems
  };
}

async function lookupInventoryItem(
  context: GarlandCsrAgentReportContext,
  item: GarlandShippingOrderItem,
  inventoryConfig: { userId: string; locationId: string }
): Promise<GarlandCsrAgentInventoryItem> {
  try {
    const rows = await searchTeamshipProductsForShipping({
      tenantId: context.tenantId,
      userId: inventoryConfig.userId,
      locationId: inventoryConfig.locationId,
      search: item.sku
    });
    const matchingSkuRows = rows.filter((row) => normalizeIdentifier(readProductSku(row)) === normalizeIdentifier(item.sku));
    const requestedSerials = item.serialNumbers.map((serial) => serial.trim()).filter(Boolean);

    if (matchingSkuRows.length === 0) {
      return {
        sku: item.sku,
        requestedSerials,
        requestedQuantity: item.quantity,
        status: "SKU_NOT_AVAILABLE",
        note: "No available Teamship inventory row was returned for this SKU.",
        alternativeSerials: []
      };
    }

    const serials = matchingSkuRows.map(readProductSerial).filter((serial): serial is string => Boolean(serial));
    const quarantinedRows = matchingSkuRows.filter((row) => readBooleanFlag(row.is_quarantine) || readBooleanFlag(row.is_quarantine_stock));
    const hasExactSerial = requestedSerials.length > 0 && requestedSerials.every((serial) => serials.some((candidate) => normalizeIdentifier(candidate) === normalizeIdentifier(serial)));

    if (hasExactSerial) {
      return {
        sku: item.sku,
        requestedSerials,
        requestedQuantity: item.quantity,
        status: quarantinedRows.length > 0 ? "QUARANTINED_STOCK_AVAILABLE" : "EXACT_SKU_SERIAL_AVAILABLE",
        note: quarantinedRows.length > 0
          ? "The requested SKU/serial appears available, but at least one matching stock row is quarantined."
          : "The requested SKU/serial combination appears available in Teamship inventory.",
        alternativeSerials: serials.filter((serial) => !requestedSerials.some((requested) => normalizeIdentifier(requested) === normalizeIdentifier(serial))).slice(0, 6)
      };
    }

    if (requestedSerials.length > 0) {
      return {
        sku: item.sku,
        requestedSerials,
        requestedQuantity: item.quantity,
        status: quarantinedRows.length > 0 ? "QUARANTINED_STOCK_AVAILABLE" : "SKU_AVAILABLE_SERIAL_MISSING",
        note: serials.length > 0
          ? "SKU exists, but the requested serial was not returned by Teamship inventory search."
          : "SKU exists, but Teamship did not return serial-level inventory evidence.",
        alternativeSerials: serials.slice(0, 6)
      };
    }

    return {
      sku: item.sku,
      requestedSerials,
      requestedQuantity: item.quantity,
      status: quarantinedRows.length > 0 ? "QUARANTINED_STOCK_AVAILABLE" : "SKU_AVAILABLE",
      note: quarantinedRows.length > 0 ? "SKU exists, but at least one available row is quarantined." : "SKU appears available in Teamship inventory.",
      alternativeSerials: serials.slice(0, 6)
    };
  } catch (error) {
    return {
      sku: item.sku,
      requestedSerials: item.serialNumbers,
      requestedQuantity: item.quantity,
      status: "UNKNOWN",
      note: error instanceof Error ? error.message : "Inventory lookup failed.",
      alternativeSerials: []
    };
  }
}

function buildOrderLine(order: GarlandTeamshipOrderReview, note: string, actions: string[] = []): GarlandCsrAgentOrderLine {
  return {
    psNumber: order.psNumber,
    srNumber: order.srNumber,
    teamshipOrderId: order.teamshipOrderId,
    teamshipUrl: order.teamshipUrl,
    status: order.status,
    note,
    actions
  };
}

function buildIssueLine(order: GarlandTeamshipOrderReview, updateOrder: UpdateJobForReport["orders"][number] | undefined): GarlandCsrAgentIssueLine {
  const fieldIssues = order.fields
    .filter((field) => field.status === "DISCREPANCY" || field.status === "MISSING")
    .map((field) => `${field.label}: ${field.message}`);
  const updateIssues = [
    ...readStringArray(updateOrder?.validationIssues),
    updateOrder?.errorMessage
  ].filter((issue): issue is string => Boolean(issue));

  return {
    ...buildOrderLine(order, updateOrder?.status === "FAILED" ? "The update agent attempted this order and reported a failure." : "PDF and Teamship values need CSR review."),
    issues: [...fieldIssues, ...updateIssues].slice(0, 8)
  };
}

function buildOrderTable(input: {
  review: GarlandTeamshipReviewResponse;
  updateOrdersBySr: Map<string, UpdateJobForReport["orders"][number]>;
  missingTeamshipOrders: GarlandCsrAgentMissingOrder[];
}): GarlandCsrAgentOrderTableRow[] {
  const reviewsBySr = new Map(input.review.reviews.map((review) => [normalizeIdentifier(review.srNumber), review]));
  const missingBySr = new Map(input.missingTeamshipOrders.map((order) => [normalizeIdentifier(order.srNumber), order]));

  return input.review.pdfOrders.map((pdfOrder) => {
    const review = reviewsBySr.get(normalizeIdentifier(pdfOrder.srNumber));
    const updateOrder = input.updateOrdersBySr.get(normalizeIdentifier(pdfOrder.srNumber));
    const missingOrder = missingBySr.get(normalizeIdentifier(pdfOrder.srNumber));
    const issues = review ? summarizeReviewIssues(review, updateOrder) : ["No review result was stored for this PDF order."];
    const botChanges = updateOrder?.status === "SUCCESS" ? summarizeUpdateActions(updateOrder) : [];
    const inventorySummary = missingOrder ? summarizeInventoryItems(missingOrder.inventoryItems) : [];

    return {
      tone: determineRowTone(review, updateOrder),
      statusLabel: buildRowStatusLabel(review, updateOrder),
      psNumber: pdfOrder.psNumber,
      srNumber: pdfOrder.srNumber,
      teamshipOrderId: review?.teamshipOrderId ?? null,
      teamshipUrl: review?.teamshipUrl ?? null,
      botChanges: botChanges.length ? botChanges : [defaultBotChangeText(review, updateOrder)],
      matchIssues: issues.length ? issues : ["No match issues found."],
      inventorySummary
    };
  });
}

function determineRowTone(
  review: GarlandTeamshipOrderReview | undefined,
  updateOrder: UpdateJobForReport["orders"][number] | undefined
): GarlandCsrAgentOrderTableRow["tone"] {
  if (!review || review.status === "MISSING_TEAMSHIP" || review.status === "PENDING_TEAMSHIP") {
    return "gray";
  }

  if (review.status === "FAIL" || updateOrder?.status === "FAILED") {
    return "red";
  }

  if (updateOrder?.status === "SUCCESS") {
    return "green";
  }

  return review.status === "PASS" ? "yellow" : "red";
}

function buildRowStatusLabel(
  review: GarlandTeamshipOrderReview | undefined,
  updateOrder: UpdateJobForReport["orders"][number] | undefined
) {
  if (!review) {
    return "Review missing";
  }

  if (review.status === "MISSING_TEAMSHIP") {
    return "Not in Teamship";
  }

  if (review.status === "PENDING_TEAMSHIP") {
    return "Pending Teamship";
  }

  if (updateOrder?.status === "FAILED") {
    return "Needs review";
  }

  if (review.status === "FAIL") {
    return "Needs review";
  }

  if (updateOrder?.status === "SUCCESS") {
    return "Complete";
  }

  return "Matched";
}

function defaultBotChangeText(
  review: GarlandTeamshipOrderReview | undefined,
  updateOrder: UpdateJobForReport["orders"][number] | undefined
) {
  if (updateOrder?.status === "FAILED") {
    return "Bot attempted this order but did not complete it.";
  }

  if (!review || review.status === "MISSING_TEAMSHIP" || review.status === "PENDING_TEAMSHIP") {
    return "No Teamship update made because the order was not matched to Teamship.";
  }

  if (review.status === "PASS") {
    return "Matched successfully; no completed bot update was attached to this report.";
  }

  return "No bot update completed.";
}

function summarizeReviewIssues(
  review: GarlandTeamshipOrderReview,
  updateOrder: UpdateJobForReport["orders"][number] | undefined
) {
  const fieldIssues = review.fields
    .filter((field) => field.status === "DISCREPANCY" || field.status === "MISSING")
    .map((field) => `${field.label}: ${field.message}`);
  const updateIssues = [
    ...readStringArray(updateOrder?.validationIssues),
    updateOrder?.errorMessage
  ].filter((issue): issue is string => Boolean(issue));

  if (review.status === "MISSING_TEAMSHIP") {
    return ["No matching Teamship order was found for this Garland PDF order."];
  }

  if (review.status === "PENDING_TEAMSHIP") {
    return ["Teamship alert indicates this order is not available in Teamship yet."];
  }

  return [...fieldIssues, ...updateIssues].slice(0, 8);
}

function summarizeInventoryItems(items: GarlandCsrAgentInventoryItem[]) {
  if (items.length === 0) {
    return ["No item-level inventory details were available."];
  }

  return items.map((item) => {
    const serialText = item.requestedSerials.length ? ` requested serial(s): ${item.requestedSerials.join(", ")}.` : "";
    const alternatives = item.alternativeSerials.length ? ` Possible alternate serials: ${item.alternativeSerials.join(", ")}.` : "";
    return `${item.sku}:${serialText} ${item.note}${alternatives}`.replace(/\s+/g, " ").trim();
  });
}

function buildNextSteps(summary: GarlandCsrAgentReport["summary"], rows: GarlandCsrAgentOrderTableRow[]) {
  const steps: string[] = [];
  const redRows = rows.filter((row) => row.tone === "red");
  const missingRows = rows.filter((row) => row.tone === "gray");
  const completedRows = rows.filter((row) => row.tone === "green");

  if (redRows.length > 0) {
    steps.push(`Review the ${redRows.length} red shipment(s) before considering the run complete.`);
  }

  if (missingRows.length > 0) {
    steps.push(`Follow up on ${missingRows.length} Garland PDF order(s) that were not matched to Teamship.`);
  }

  if (summary.noPdfCount > 0) {
    steps.push(`${summary.noPdfCount} Teamship order(s) did not have a Garland PDF in this run; check whether another attachment is still coming.`);
  }

  if (completedRows.length > 0) {
    steps.push(`${completedRows.length} green shipment(s) were matched and updated; no action needed unless you want to spot-check.`);
  }

  return steps.length ? steps : ["No follow-up needed based on this run."];
}

function readReviewResponse(value: unknown): GarlandTeamshipReviewResponse {
  if (
    !value ||
    typeof value !== "object" ||
    !("summary" in value) ||
    !("pdfOrders" in value) ||
    !Array.isArray((value as GarlandTeamshipReviewResponse).pdfOrders) ||
    !("reviews" in value) ||
    !Array.isArray((value as GarlandTeamshipReviewResponse).reviews)
  ) {
    throw new Error("Saved Teamship review run does not contain a valid review response.");
  }

  return value as GarlandTeamshipReviewResponse;
}

function readInventoryLookupConfig() {
  const userId = process.env.GARLAND_TEAMSHIP_INVENTORY_USER_ID?.trim() || process.env.TEAMSHIP_GARLAND_USER_ID?.trim();
  const locationId =
    process.env.GARLAND_TEAMSHIP_INVENTORY_LOCATION_ID?.trim() || process.env.TEAMSHIP_GARLAND_LOCATION_ID?.trim();

  return userId && locationId ? { userId, locationId } : null;
}

function renderReportText(report: Omit<GarlandCsrAgentReport, "text" | "html">) {
  const lines = [
    "Hello, Jane reporting for duty.",
    "",
    "I reviewed the Garland PDF orders against Teamship and updated the shipments I could confidently complete. Below is the summary of what I worked on, what matched, and what still needs a human set of eyes.",
    "",
    `Garland Teamship CSR Agent Report - ${report.documentLabel}`,
    `Shipment date: ${report.shipmentDate}`,
    `Source PDF: ${report.sourcePdfFileName ?? "Not saved"}`,
    "",
    "Summary",
    `- ${report.summary.pdfOrderCount} Garland PDF order(s) reviewed`,
    `- ${report.summary.teamshipMatchedCount} order(s) matched in Teamship`,
    `- ${report.summary.updatedCount} order(s) updated by the bot`,
    `- ${report.summary.needsReviewCount} order(s) need CSR review`,
    `- ${report.summary.missingTeamshipCount + report.summary.pendingTeamshipCount} Garland order(s) not matched to Teamship`,
    `- ${report.summary.noPdfCount} Teamship order(s) had no matching Garland PDF`,
    ""
  ];

  lines.push("Order review table");
  if (report.orderTable.length === 0) {
    lines.push("- No Garland PDF orders were stored in this run.", "");
  } else {
    for (const order of report.orderTable) {
      lines.push(
        `- [${order.statusLabel}] PS ${order.psNumber} / SR ${order.srNumber} / Teamship ${order.teamshipOrderId ?? "Not found"}`
      );
      lines.push(`  - Bot changes: ${order.botChanges.join(" | ")}`);
      lines.push(`  - Match issues: ${order.matchIssues.join(" | ")}`);
      if (order.inventorySummary.length > 0) {
        lines.push(`  - Inventory check: ${order.inventorySummary.join(" | ")}`);
      }
    }
    lines.push("");
  }

  lines.push("What I need from you");
  for (const step of report.nextSteps) {
    lines.push(`- ${step}`);
  }
  lines.push("");

  if (!report.inventoryLookup.checked) {
    lines.push("Inventory lookup", `- ${report.inventoryLookup.skippedReason}`, "");
  }

  lines.push("Hope this helps,", "Jane", "Garland CSR Agent", "");
  lines.push(`Generated by ${report.generatedByName ?? "Newl Apps"} at ${formatDateTime(report.generatedAt)}.`);

  return lines.join("\n");
}

function renderReportHtml(report: Omit<GarlandCsrAgentReport, "text" | "html">) {
  return [
    `<div style="font-family:Arial,sans-serif;color:#1f2937;line-height:1.45">`,
    `<p style="font-size:16px;margin:0 0 8px"><strong>Hello, Jane reporting for duty.</strong></p>`,
    `<p style="margin:0 0 18px">I reviewed the Garland PDF orders against Teamship and updated the shipments I could confidently complete. Below is the summary of what I worked on, what matched, and what still needs a human set of eyes.</p>`,
    `<h2 style="margin:0 0 8px">${escapeHtml(report.subject)}</h2>`,
    `<p style="margin:0 0 18px;color:#475467"><strong>Shipment date:</strong> ${escapeHtml(report.shipmentDate)}<br><strong>Source PDF:</strong> ${escapeHtml(report.sourcePdfFileName ?? "Not saved")}</p>`,
    renderSummaryBadges(report),
    renderOrderTableHtml(report.orderTable),
    renderNextStepsHtml(report.nextSteps),
    report.inventoryLookup.checked ? "" : `<h3 style="margin:20px 0 8px">Inventory lookup</h3><p>${escapeHtml(report.inventoryLookup.skippedReason ?? "Skipped.")}</p>`,
    `<p style="margin:22px 0 0">Hope this helps,<br><strong>Jane</strong><br><span style="color:#667085">Garland CSR Agent</span></p>`,
    `<p style="color:#667085;font-size:12px;margin-top:18px">Generated by ${escapeHtml(report.generatedByName ?? "Newl Apps")} at ${escapeHtml(formatDateTime(report.generatedAt))}.</p>`,
    `</div>`
  ].join("\n");
}

function renderSummaryBadges(report: Omit<GarlandCsrAgentReport, "text" | "html">) {
  const badgeStyle =
    "display:inline-block;border-radius:999px;padding:8px 12px;margin:0 8px 8px 0;font-size:13px;font-weight:700";
  const badges = [
    { label: `${report.summary.pdfOrderCount} reviewed`, color: "#344054", background: "#eef2f7" },
    { label: `${report.summary.updatedCount} completed`, color: "#027a48", background: "#dcfae6" },
    { label: `${report.summary.needsReviewCount} need review`, color: "#b42318", background: "#fee4e2" },
    {
      label: `${report.summary.missingTeamshipCount + report.summary.pendingTeamshipCount} not in Teamship`,
      color: "#475467",
      background: "#f2f4f7"
    },
    { label: `${report.summary.noPdfCount} no PDF`, color: "#b54708", background: "#fef0c7" }
  ];

  return `<div style="margin:0 0 18px">${badges
    .map(
      (badge) =>
        `<span style="${badgeStyle};color:${badge.color};background:${badge.background}">${escapeHtml(badge.label)}</span>`
    )
    .join("")}</div>`;
}

function renderOrderTableHtml(rows: GarlandCsrAgentOrderTableRow[]) {
  if (rows.length === 0) {
    return `<h3 style="margin:20px 0 8px">Order review table</h3><p>No Garland PDF orders were stored in this run.</p>`;
  }

  const border = "1px solid #d0d5dd";
  const cellStyle = `padding:10px;vertical-align:top;border-bottom:${border};font-size:13px`;
  const headerStyle = `${cellStyle};background:#f9fafb;color:#475467;text-transform:uppercase;font-weight:700;letter-spacing:.03em`;

  return [
    `<h3 style="margin:20px 0 8px">Order review table</h3>`,
    `<table role="presentation" cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse;border:${border};border-radius:10px;overflow:hidden">`,
    `<thead><tr>`,
    `<th align="left" style="${headerStyle}">Status</th>`,
    `<th align="left" style="${headerStyle}">PS</th>`,
    `<th align="left" style="${headerStyle}">SR</th>`,
    `<th align="left" style="${headerStyle}">Teamship</th>`,
    `<th align="left" style="${headerStyle}">Bot changes</th>`,
    `<th align="left" style="${headerStyle}">Match issues</th>`,
    `<th align="left" style="${headerStyle}">Missing / inventory check</th>`,
    `</tr></thead>`,
    `<tbody>`,
    rows.map((row) => renderOrderTableRowHtml(row, cellStyle)).join(""),
    `</tbody></table>`
  ].join("");
}

function renderOrderTableRowHtml(row: GarlandCsrAgentOrderTableRow, cellStyle: string) {
  const colors = rowToneColors(row.tone);
  const teamship = row.teamshipOrderId
    ? row.teamshipUrl
      ? `<a href="${escapeHtml(row.teamshipUrl)}" style="color:#e83f63;font-weight:700;text-decoration:none">${escapeHtml(row.teamshipOrderId)}</a>`
      : escapeHtml(row.teamshipOrderId)
    : "Not found";

  return [
    `<tr style="background:${colors.background};border-left:6px solid ${colors.accent}">`,
    `<td style="${cellStyle}"><span style="display:inline-block;border-radius:999px;padding:5px 9px;color:${colors.text};background:${colors.badge};font-weight:700">${escapeHtml(row.statusLabel)}</span></td>`,
    `<td style="${cellStyle};font-weight:700">${escapeHtml(row.psNumber)}</td>`,
    `<td style="${cellStyle};font-weight:700">${escapeHtml(row.srNumber)}</td>`,
    `<td style="${cellStyle}">${teamship}</td>`,
    `<td style="${cellStyle}">${renderInlineList(row.botChanges)}</td>`,
    `<td style="${cellStyle}">${renderInlineList(row.matchIssues)}</td>`,
    `<td style="${cellStyle}">${row.inventorySummary.length ? renderInlineList(row.inventorySummary) : "N/A"}</td>`,
    `</tr>`
  ].join("");
}

function rowToneColors(tone: GarlandCsrAgentOrderTableRow["tone"]) {
  switch (tone) {
    case "green":
      return { accent: "#039855", background: "#f6fef9", badge: "#dcfae6", text: "#027a48" };
    case "yellow":
      return { accent: "#f79009", background: "#fffcf5", badge: "#fef0c7", text: "#b54708" };
    case "gray":
      return { accent: "#98a2b3", background: "#f9fafb", badge: "#eef2f7", text: "#475467" };
    case "red":
    default:
      return { accent: "#d92d20", background: "#fffbfa", badge: "#fee4e2", text: "#b42318" };
  }
}

function renderInlineList(items: string[]) {
  if (items.length === 0) {
    return "None";
  }

  return `<ul style="margin:0;padding-left:18px">${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
}

function renderNextStepsHtml(nextSteps: string[]) {
  return [
    `<h3 style="margin:20px 0 8px">What Jane needs from you</h3>`,
    `<div style="border:1px solid #fedf89;background:#fffcf5;border-radius:10px;padding:12px 14px">`,
    renderInlineList(nextSteps),
    `</div>`
  ].join("");
}

function buildReportSubject(run: ReviewRunForReport, summary: GarlandCsrAgentReport["summary"]) {
  const issueCount = summary.needsReviewCount + summary.missingTeamshipCount + summary.pendingTeamshipCount;
  return `Garland Teamship Review - ${run.documentLabel} - ${summary.updatedCount} updated, ${issueCount} need review`;
}

function readProductSku(row: TeamshipShippingProductSearchRow) {
  return row.sku ?? row.product_sku ?? null;
}

function readProductSerial(row: TeamshipShippingProductSearchRow) {
  const attributes = row.custom_attributes ?? row.customAttributes ?? [];
  const serialAttribute = attributes.find((attribute) => normalizeIdentifier(attribute.name) === "SERIAL");
  const value = serialAttribute?.value;
  return typeof value === "string" && value.trim() ? value.trim() : typeof value === "number" ? String(value) : null;
}

function readBooleanFlag(value: unknown) {
  return value === true || value === 1 || value === "1" || String(value).toLowerCase() === "true";
}

function readStringArray(value: unknown) {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

function summarizeUpdateActions(order: UpdateJobForReport["orders"][number]) {
  return [
    ...readJsonArray(order.plannedFieldUpdates).map(describeFieldUpdate),
    ...readJsonArray(order.plannedPalletRows).map(describePalletRow)
  ].filter(Boolean).slice(0, 12);
}

function describeFieldUpdate(value: unknown) {
  const update = readRecord(value);
  const label = readString(update.label) || readString(update.teamshipField) || "Teamship field";
  const proposedValue = readString(update.proposedValue);
  const currentValue = readString(update.currentValue);

  if (!proposedValue) {
    return `${label} updated.`;
  }

  return currentValue && currentValue !== proposedValue
    ? `${label}: ${currentValue} -> ${proposedValue}`
    : `${label}: ${proposedValue}`;
}

function describePalletRow(value: unknown) {
  const row = readRecord(value);
  const rowNumber = readString(row.rowNumber) || "?";
  const sku = readString(row.sku) || "SKU not captured";
  const quantity = readString(row.quantity) || "1";
  const length = readString(row.lengthIn);
  const width = readString(row.widthIn);
  const height = readString(row.heightIn);
  const weight = readString(row.weightLb);
  const unit = readString(row.weightUnit) || "lbs";
  const commodity = readString(row.commodity);
  const dims = length && width && height && weight ? `${length} x ${width} x ${height}, ${weight} ${unit}` : "dims not captured";

  return `Pallet row ${rowNumber}: SKU ${sku}, qty ${quantity}, ${dims}${commodity ? `, ${commodity}` : ""}`;
}

function readJsonArray(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function readString(value: unknown) {
  if (typeof value === "string") {
    return value.trim();
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return "";
}

function formatInputDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("en-CA", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Toronto"
  });
}

function normalizeIdentifier(value: unknown) {
  return String(value ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function resolveRecipients(value?: string | string[]) {
  if (Array.isArray(value)) {
    return value.map((recipient) => recipient.trim()).filter(Boolean);
  }

  return parseEmailRecipients(value || process.env.GARLAND_CSR_AGENT_REPORT_TO);
}

function resolveEmailFrom() {
  return process.env.GARLAND_CSR_AGENT_EMAIL_FROM?.trim() || process.env.RESEND_FROM_EMAIL?.trim() || "";
}

function resolveReplyTo() {
  return (
    process.env.GARLAND_CSR_AGENT_REPLY_TO?.trim() ||
    process.env.TEAMSHIP_REVIEW_REPLY_TO?.trim() ||
    process.env.GARLAND_CSR_AGENT_EMAIL_FROM?.trim() ||
    null
  );
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
