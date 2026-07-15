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
import type { AuthenticatedContext } from "@/server/tenant-context";

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
  inventoryLookup: {
    checked: boolean;
    skippedReason: string | null;
  };
  subject: string;
  text: string;
  html: string;
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

export async function buildGarlandCsrAgentReport(context: AuthenticatedContext, runId: string): Promise<GarlandCsrAgentReport> {
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
  context: AuthenticatedContext,
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
  context: AuthenticatedContext,
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
    `Garland Teamship CSR Agent Report - ${report.documentLabel}`,
    `Shipment date: ${report.shipmentDate}`,
    `Source PDF: ${report.sourcePdfFileName ?? "Not saved"}`,
    "",
    "Summary",
    `- ${report.summary.updatedCount} order(s) updated by the bot`,
    `- ${report.summary.needsReviewCount} order(s) need CSR review`,
    `- ${report.summary.missingTeamshipCount + report.summary.pendingTeamshipCount} Garland order(s) not matched to Teamship`,
    `- ${report.summary.noPdfCount} Teamship order(s) had no matching Garland PDF`,
    ""
  ];

  appendOrderSection(lines, "Updated in Teamship", report.completedUpdates);
  appendIssueSection(lines, "Needs CSR review", report.needsReview);
  appendMissingSection(lines, "Missing or pending in Teamship", report.missingTeamshipOrders);
  appendOrderSection(lines, "Teamship orders with no Garland PDF", report.noPdfOrders);

  if (!report.inventoryLookup.checked) {
    lines.push("Inventory lookup", `- ${report.inventoryLookup.skippedReason}`, "");
  }

  lines.push(`Generated by ${report.generatedByName ?? "Newl Apps"} at ${formatDateTime(report.generatedAt)}.`);

  return lines.join("\n");
}

function renderReportHtml(report: Omit<GarlandCsrAgentReport, "text" | "html">) {
  return [
    `<h2>${escapeHtml(report.subject)}</h2>`,
    `<p><strong>Shipment date:</strong> ${escapeHtml(report.shipmentDate)}<br><strong>Source PDF:</strong> ${escapeHtml(report.sourcePdfFileName ?? "Not saved")}</p>`,
    `<ul>`,
    `<li>${report.summary.updatedCount} order(s) updated by the bot</li>`,
    `<li>${report.summary.needsReviewCount} order(s) need CSR review</li>`,
    `<li>${report.summary.missingTeamshipCount + report.summary.pendingTeamshipCount} Garland order(s) not matched to Teamship</li>`,
    `<li>${report.summary.noPdfCount} Teamship order(s) had no matching Garland PDF</li>`,
    `</ul>`,
    renderOrderHtmlSection("Updated in Teamship", report.completedUpdates),
    renderIssueHtmlSection("Needs CSR review", report.needsReview),
    renderMissingHtmlSection("Missing or pending in Teamship", report.missingTeamshipOrders),
    renderOrderHtmlSection("Teamship orders with no Garland PDF", report.noPdfOrders),
    report.inventoryLookup.checked ? "" : `<h3>Inventory lookup</h3><p>${escapeHtml(report.inventoryLookup.skippedReason ?? "Skipped.")}</p>`,
    `<p style="color:#667085;font-size:12px">Generated by ${escapeHtml(report.generatedByName ?? "Newl Apps")} at ${escapeHtml(formatDateTime(report.generatedAt))}.</p>`
  ].join("\n");
}

function appendOrderSection(lines: string[], title: string, orders: GarlandCsrAgentOrderLine[]) {
  lines.push(title);
  if (orders.length === 0) {
    lines.push("- None", "");
    return;
  }

  for (const order of orders) {
    lines.push(`- ${order.psNumber} / ${order.srNumber}: ${order.note}`);
    for (const action of order.actions) {
      lines.push(`  - ${action}`);
    }
  }
  lines.push("");
}

function appendIssueSection(lines: string[], title: string, orders: GarlandCsrAgentIssueLine[]) {
  lines.push(title);
  if (orders.length === 0) {
    lines.push("- None", "");
    return;
  }

  for (const order of orders) {
    lines.push(`- ${order.psNumber} / ${order.srNumber}: ${order.note}`);
    for (const issue of order.issues) {
      lines.push(`  - ${issue}`);
    }
  }
  lines.push("");
}

function appendMissingSection(lines: string[], title: string, orders: GarlandCsrAgentMissingOrder[]) {
  lines.push(title);
  if (orders.length === 0) {
    lines.push("- None", "");
    return;
  }

  for (const order of orders) {
    lines.push(`- ${order.psNumber} / ${order.srNumber}: ${order.note}`);
    for (const item of order.inventoryItems) {
      lines.push(`  - ${item.sku}: ${item.note}${item.alternativeSerials.length ? ` Alternatives: ${item.alternativeSerials.join(", ")}` : ""}`);
    }
  }
  lines.push("");
}

function renderOrderHtmlSection(title: string, orders: GarlandCsrAgentOrderLine[]) {
  return `<h3>${escapeHtml(title)}</h3>${orders.length ? `<ul>${orders.map((order) => `<li><strong>${escapeHtml(order.psNumber)} / ${escapeHtml(order.srNumber)}</strong>: ${escapeHtml(order.note)}${order.actions.length ? `<ul>${order.actions.map((action) => `<li>${escapeHtml(action)}</li>`).join("")}</ul>` : ""}</li>`).join("")}</ul>` : "<p>None</p>"}`;
}

function renderIssueHtmlSection(title: string, orders: GarlandCsrAgentIssueLine[]) {
  if (orders.length === 0) {
    return `<h3>${escapeHtml(title)}</h3><p>None</p>`;
  }

  return `<h3>${escapeHtml(title)}</h3><ul>${orders
    .map(
      (order) =>
        `<li><strong>${escapeHtml(order.psNumber)} / ${escapeHtml(order.srNumber)}</strong>: ${escapeHtml(order.note)}${order.issues.length ? `<ul>${order.issues.map((issue) => `<li>${escapeHtml(issue)}</li>`).join("")}</ul>` : ""}</li>`
    )
    .join("")}</ul>`;
}

function renderMissingHtmlSection(title: string, orders: GarlandCsrAgentMissingOrder[]) {
  if (orders.length === 0) {
    return `<h3>${escapeHtml(title)}</h3><p>None</p>`;
  }

  return `<h3>${escapeHtml(title)}</h3><ul>${orders
    .map(
      (order) =>
        `<li><strong>${escapeHtml(order.psNumber)} / ${escapeHtml(order.srNumber)}</strong>: ${escapeHtml(order.note)}${order.inventoryItems.length ? `<ul>${order.inventoryItems.map((item) => `<li>${escapeHtml(item.sku)}: ${escapeHtml(item.note)}${item.alternativeSerials.length ? ` Alternatives: ${escapeHtml(item.alternativeSerials.join(", "))}` : ""}</li>`).join("")}</ul>` : ""}</li>`
    )
    .join("")}</ul>`;
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

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
