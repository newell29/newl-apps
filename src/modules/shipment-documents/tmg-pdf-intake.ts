import { createHash } from "node:crypto";

import { PDFDocument } from "pdf-lib";

import type {
  TmgBolEvidence,
  TmgLabelEvidence,
  TmgOrderValidationIssue,
  TmgPackingSlipOrder,
  TmgPicklistOrder,
  TmgPreparedBatch,
  TmgPreparedOrder,
  TmgSourcePdfAttachment
} from "@/modules/shipment-documents/tmg-order-types";
import { extractPdfTextPagesFromBytes } from "@/server/pdf-text";

const MAX_TEAMSHIP_DOCUMENT_BYTES = 2 * 1024 * 1024;
const CUSTOMER_REFERENCE_PATTERN = /\bUS\d{4,}\b/i;
const SKU_PATTERN = /\bTMG-[A-Z0-9][A-Z0-9-]*\b/gi;
const TRACKING_PATTERN = /\b\d{3}-\d{7,}\b/;

type PositionedWord = {
  text: string;
  x: number;
  y: number;
};

type PositionedPage = {
  pageNumber: number;
  width: number;
  height: number;
  text: string;
  words: PositionedWord[];
};

type ExtractedAttachment = TmgSourcePdfAttachment & {
  contentHash: string;
  pages: PositionedPage[];
};

export async function prepareTmgEmailBatch(attachments: TmgSourcePdfAttachment[]): Promise<TmgPreparedBatch> {
  const pdfAttachments = attachments.filter(isPdfAttachment);
  const uniqueAttachments: ExtractedAttachment[] = [];
  const seenHashes = new Set<string>();
  let duplicatePdfCount = 0;

  for (const attachment of pdfAttachments) {
    const contentHash = createHash("sha256").update(attachment.bytes).digest("hex");
    if (seenHashes.has(contentHash)) {
      duplicatePdfCount += 1;
      continue;
    }
    seenHashes.add(contentHash);
    uniqueAttachments.push({
      ...attachment,
      contentHash,
      pages: await extractPositionedPdfPages(attachment.bytes)
    });
  }

  const packingSlipOrders = uniqueAttachments.flatMap((attachment) =>
    attachment.pages.flatMap((page) => {
      const order = parseTmgPackingSlipPage(page, attachment);
      return order ? [order] : [];
    })
  );
  const picklistOrders = uniqueAttachments.flatMap((attachment) =>
    attachment.pages.flatMap((page) => parseTmgPicklistPage(page, attachment))
  );
  const bolEvidence = uniqueAttachments.flatMap((attachment) => parseTmgBolAttachment(attachment));
  const labelEvidence = uniqueAttachments.flatMap((attachment) => parseTmgLabelAttachment(attachment));
  const orders = await Promise.all(
    packingSlipOrders.map((packingSlip) =>
      prepareOrder({ packingSlip, picklistOrders, bolEvidence, labelEvidence, attachments: uniqueAttachments })
    )
  );

  const duplicatePackingReferences = findDuplicateValues(packingSlipOrders.map((order) => order.customerReference));
  for (const order of orders) {
    if (duplicatePackingReferences.has(order.customerReference)) {
      order.validationIssues.push({
        code: "DUPLICATE_PACKING_SLIP",
        message: `More than one packing-slip page contains ${order.customerReference}.`
      });
      order.readyForApproval = false;
    }
  }

  const batchIssues: string[] = [];
  if (pdfAttachments.length === 0) batchIssues.push("No PDF attachments were found.");
  if (packingSlipOrders.length === 0) batchIssues.push("No TMG packing-slip orders were found.");

  return {
    attachmentCount: attachments.length,
    uniquePdfCount: uniqueAttachments.length,
    duplicatePdfCount,
    packingSlipOrders,
    picklistOrders,
    orders,
    batchIssues
  };
}

export function parseTmgPackingSlipPage(
  page: PositionedPage,
  attachment: Pick<TmgSourcePdfAttachment, "sourceId" | "fileName">
): TmgPackingSlipOrder | null {
  if (!/TMG\s+INDUSTRIAL\s+USA/i.test(page.text) || !/SHIP\s+TO\s+BILL\s+TO/i.test(normalizeText(page.text))) {
    return null;
  }

  const reference = normalizeCustomerReference(page.text.match(/Order\s*#?\s*(US\d{4,})/i)?.[1]);
  if (!reference) return null;

  const sectionLines = readShipToLines(page);
  const locationIndex = sectionLines.findIndex((line) => parseLocationLine(line) !== null);
  const location = locationIndex >= 0 ? parseLocationLine(sectionLines[locationIndex]!) : null;
  const countryIndex = sectionLines.findIndex((line) => /^(United States|Canada)$/i.test(line));
  const addressStart = sectionLines.findIndex((line, index) => index > 0 && looksLikeStreetAddress(line));
  const addressEnd = locationIndex >= 0 ? locationIndex : countryIndex;
  const addressLines =
    addressStart >= 0 && addressEnd > addressStart
      ? sectionLines.slice(addressStart, addressEnd)
      : locationIndex > 1
        ? [sectionLines[locationIndex - 1]!]
        : [];
  const quantityMatches = Array.from(page.text.matchAll(/\b(\d+)\s+of\s+\d+\b/gi)).map((match) => Number(match[1]));
  const skus = Array.from(new Set((page.text.match(SKU_PATTERN) ?? []).map((sku) => sku.toUpperCase())));
  const orderDate = parsePackingSlipDate(page.text);

  return {
    customerReference: reference,
    orderDate,
    shipTo: {
      name: sectionLines[0] ?? null,
      address: addressLines.length > 0 ? addressLines.join(", ") : null,
      city: location?.city ?? null,
      state: location?.state ?? null,
      postalCode: location?.postalCode ?? null,
      countryCode: readCountryCode(sectionLines[countryIndex]),
      phone: sectionLines.find((line) => /(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}/.test(line)) ?? null,
      email: null
    },
    items: skus.map((sku, index) => ({
      sku,
      quantity: quantityMatches.length === 1 ? quantityMatches[0]! : quantityMatches[index] ?? null
    })),
    deliveryNotes: readSectionText(page.text, "NOTES", "Thank you for shopping with us!"),
    sourceAttachmentId: attachment.sourceId,
    sourceFileName: attachment.fileName,
    sourcePageNumber: page.pageNumber,
    sourceText: page.text
  };
}

export function parseTmgPicklistPage(
  page: PositionedPage,
  attachment: Pick<TmgSourcePdfAttachment, "sourceId" | "fileName"> = { sourceId: "unknown", fileName: "unknown.pdf" }
): TmgPicklistOrder[] {
  if (!/Order\s+Number/i.test(page.text) || !/Tracking\s+number/i.test(page.text) || !/\bNotes\b/i.test(page.text)) {
    return [];
  }

  const notesHeading = page.words.find((word) => /^Notes$/i.test(word.text));
  const referenceWords = page.words
    .filter((word) => /^US\d{4,}$/i.test(word.text))
    .sort((left, right) => right.y - left.y);

  return referenceWords.map((referenceWord) => {
    const lineWords = page.words
      .filter((word) => Math.abs(word.y - referenceWord.y) <= 3)
      .sort((left, right) => left.x - right.x);
    const sku = lineWords.find((word) => /^TMG-[A-Z0-9-]+$/i.test(word.text))?.text.toUpperCase() ?? null;
    const trackingNumber = lineWords.map((word) => word.text).join(" ").match(TRACKING_PATTERN)?.[0] ?? null;
    const quantity = readPicklistQuantity(lineWords, sku);
    const warehouseInstructions = notesHeading
      ? readNearestPicklistNotes(page, referenceWords, referenceWord, notesHeading)
      : null;

    return {
      customerReference: referenceWord.text.toUpperCase(),
      sku,
      quantity,
      trackingNumber,
      warehouseInstructions,
      sourceAttachmentId: attachment.sourceId,
      sourceFileName: attachment.fileName,
      sourcePageNumber: page.pageNumber
    };
  });
}

async function prepareOrder({
  packingSlip,
  picklistOrders,
  bolEvidence,
  labelEvidence,
  attachments
}: {
  packingSlip: TmgPackingSlipOrder;
  picklistOrders: TmgPicklistOrder[];
  bolEvidence: TmgBolEvidence[];
  labelEvidence: TmgLabelEvidence[];
  attachments: ExtractedAttachment[];
}): Promise<TmgPreparedOrder> {
  const picklist = picklistOrders.find((order) => order.customerReference === packingSlip.customerReference) ?? null;
  const matchingBols = bolEvidence.filter((bol) => bol.customerReference === packingSlip.customerReference);
  const matchingLabels = labelEvidence.filter((label) => label.customerReference === packingSlip.customerReference);
  const bol = matchingBols.length === 1 ? matchingBols[0]! : null;
  const label = matchingLabels.length === 1 ? matchingLabels[0]! : null;
  const validationIssues = validatePreparedOrder({ packingSlip, picklist, matchingBols, matchingLabels });
  let combinedPdfBytes: Uint8Array | null = null;
  let combinedPdfHash: string | null = null;
  let combinedPdfFileName: string | null = null;

  if (bol && label) {
    const packingAttachment = attachments.find((attachment) => attachment.sourceId === packingSlip.sourceAttachmentId);
    const bolAttachment = attachments.find((attachment) => attachment.sourceId === bol.sourceAttachmentId);
    const labelAttachment = attachments.find((attachment) => attachment.sourceId === label.sourceAttachmentId);
    if (packingAttachment && bolAttachment && labelAttachment) {
      combinedPdfBytes = await buildTmgCombinedOrderPdf({
        packingSlipPdf: packingAttachment.bytes,
        packingSlipPageNumber: packingSlip.sourcePageNumber,
        bolPdf: bolAttachment.bytes,
        labelPdf: labelAttachment.bytes
      });
      combinedPdfHash = createHash("sha256").update(combinedPdfBytes).digest("hex");
      combinedPdfFileName = `TMG ${packingSlip.customerReference}.pdf`;
      if (combinedPdfBytes.byteLength > MAX_TEAMSHIP_DOCUMENT_BYTES) {
        validationIssues.push({
          code: "PACKET_TOO_LARGE",
          message: `${combinedPdfFileName} exceeds Teamship's 2 MB document-upload limit.`
        });
      }
    }
  }

  return {
    customerReference: packingSlip.customerReference,
    packingSlip,
    picklist,
    bol,
    label,
    warehouseInstructions: picklist?.warehouseInstructions ?? null,
    deliveryNotesExcludedFromTeamship: true,
    combinedPdfFileName,
    combinedPdfBytes,
    combinedPdfHash,
    validationIssues,
    readyForApproval: validationIssues.length === 0 && Boolean(combinedPdfBytes)
  };
}

export async function buildTmgCombinedOrderPdf({
  packingSlipPdf,
  packingSlipPageNumber,
  bolPdf,
  labelPdf
}: {
  packingSlipPdf: Uint8Array;
  packingSlipPageNumber: number;
  bolPdf: Uint8Array;
  labelPdf: Uint8Array;
}) {
  const packet = await PDFDocument.create();
  const packing = await PDFDocument.load(packingSlipPdf);
  const bol = await PDFDocument.load(bolPdf);
  const label = await PDFDocument.load(labelPdf);
  const packingIndex = packingSlipPageNumber - 1;
  if (packingIndex < 0 || packingIndex >= packing.getPageCount()) {
    throw new Error("TMG packing-slip page number is outside the source PDF.");
  }

  const documentPages: Array<[PDFDocument, number[]]> = [
    [packing, [packingIndex]],
    [bol, bol.getPageIndices()],
    [label, label.getPageIndices()]
  ];
  for (const [document, pageIndexes] of documentPages) {
    const pages = await packet.copyPages(document, pageIndexes);
    for (const page of pages) packet.addPage(page);
  }

  return new Uint8Array(await packet.save());
}

function validatePreparedOrder({
  packingSlip,
  picklist,
  matchingBols,
  matchingLabels
}: {
  packingSlip: TmgPackingSlipOrder;
  picklist: TmgPicklistOrder | null;
  matchingBols: TmgBolEvidence[];
  matchingLabels: TmgLabelEvidence[];
}) {
  const issues: TmgOrderValidationIssue[] = [];
  if (matchingBols.length === 0) issues.push({ code: "MISSING_BOL", message: "No BOL contains this customer reference." });
  if (matchingBols.length > 1) issues.push({ code: "DUPLICATE_BOL", message: "More than one BOL contains this customer reference." });
  if (matchingLabels.length === 0) issues.push({ code: "MISSING_LABEL", message: "No label contains this customer reference." });
  if (matchingLabels.length > 1) issues.push({ code: "DUPLICATE_LABEL", message: "More than one label contains this customer reference." });
  if (!picklist) issues.push({ code: "MISSING_PICKLIST_ORDER", message: "The customer reference is not present on the picklist." });
  if (!packingSlip.orderDate) issues.push({ code: "MISSING_ORDER_DATE", message: "The packing-slip order date could not be read." });
  if (matchingBols.length === 1 && !matchingBols[0]!.proNumber) {
    issues.push({ code: "MISSING_PRO_NUMBER", message: "The BOL PRO number could not be read." });
  }
  if (packingSlip.items.length === 0) issues.push({ code: "MISSING_PRODUCT", message: "No TMG SKU was found on the packing slip." });
  if (packingSlip.items.some((item) => !item.quantity)) {
    issues.push({ code: "MISSING_PRODUCT_QUANTITY", message: "A packing-slip product quantity could not be read." });
  }
  if (Object.values(packingSlip.shipTo).slice(0, 6).some((value) => !value)) {
    issues.push({ code: "MISSING_SHIP_TO", message: "One or more required packing-slip ship-to fields are missing." });
  }
  if (picklist && packingSlip.items.length === 1 && picklist.sku && picklist.sku !== packingSlip.items[0]!.sku) {
    issues.push({ code: "PICKLIST_SKU_MISMATCH", message: "The picklist SKU does not match the packing-slip SKU." });
  }
  if (picklist && packingSlip.items.length === 1 && picklist.quantity && picklist.quantity !== packingSlip.items[0]!.quantity) {
    issues.push({ code: "PICKLIST_QUANTITY_MISMATCH", message: "The picklist quantity does not match the packing-slip quantity." });
  }
  return issues;
}

function parseTmgBolAttachment(attachment: ExtractedAttachment): TmgBolEvidence[] {
  const text = attachment.pages.map((page) => page.text).join("\n");
  if (!/BILL\s+OF\s+LADING/i.test(text)) return [];
  const customerReference = readDocumentCustomerReference(text);
  if (!customerReference) return [];
  return [{
    customerReference,
    proNumber: text.match(/PRO#\s*:?\s*([0-9-]+)/i)?.[1] ?? null,
    carrier: readBolCarrier(text),
    sourceAttachmentId: attachment.sourceId,
    sourceFileName: attachment.fileName,
    sourceText: text
  }];
}

function parseTmgLabelAttachment(attachment: ExtractedAttachment): TmgLabelEvidence[] {
  const text = attachment.pages.map((page) => page.text).join("\n");
  if (!/\bSHIPPER\b/i.test(text) || !/\bCONSIGNEE\b/i.test(text) || !/\bBOL\s*#/i.test(text)) return [];
  const customerReference = readDocumentCustomerReference(text);
  if (!customerReference) return [];
  return [{
    customerReference,
    proNumber: text.match(/PRO#\s*:?\s*([0-9-]+)/i)?.[1] ?? null,
    sourceAttachmentId: attachment.sourceId,
    sourceFileName: attachment.fileName,
    sourceText: text
  }];
}

function readShipToLines(page: PositionedPage) {
  const shipWord = page.words.find((word) => /^SHIP(?:\s+TO)?$/i.test(word.text));
  const billWord = page.words.find((word) => /^BILL(?:\s+TO)?$/i.test(word.text) && shipWord && Math.abs(word.y - shipWord.y) <= 4);
  const itemsWord = page.words.find((word) => /^ITEMS$/i.test(word.text));
  if (!shipWord || !billWord || !itemsWord) return [];

  const words = page.words.filter((word) =>
    word.x < billWord.x - 5 &&
    isBetween(word.y, shipWord.y, itemsWord.y) &&
    Math.abs(word.y - shipWord.y) > 4 &&
    Math.abs(word.y - itemsWord.y) > 4
  );
  return groupWordsIntoLines(words).map((line) => line.text);
}

function readNearestPicklistNotes(
  page: PositionedPage,
  references: PositionedWord[],
  reference: PositionedWord,
  notesHeading: PositionedWord
) {
  const notesWords = page.words.filter((word) => {
    if (word.x < notesHeading.x - 60 || word.y >= notesHeading.y - 4 || /^Notes$/i.test(word.text)) return false;
    const nearest = references.reduce((best, candidate) =>
      Math.abs(candidate.y - word.y) < Math.abs(best.y - word.y) ? candidate : best
    );
    return nearest === reference;
  });
  const text = groupWordsIntoLines(notesWords).map((line) => line.text).join(" ").replace(/\s+/g, " ").trim();
  return text || null;
}

function readPicklistQuantity(lineWords: PositionedWord[], sku: string | null) {
  if (!sku) return null;
  const skuIndex = lineWords.findIndex((word) => word.text.toUpperCase() === sku);
  const candidate = lineWords.slice(skuIndex + 1).find((word) => /^\d+$/.test(word.text));
  return candidate ? Number(candidate.text) : null;
}

function groupWordsIntoLines(words: PositionedWord[]) {
  const lines: Array<{ y: number; words: PositionedWord[]; text: string }> = [];
  for (const word of [...words].sort((left, right) => right.y - left.y || left.x - right.x)) {
    const line = lines.find((candidate) => Math.abs(candidate.y - word.y) <= 3);
    if (line) line.words.push(word);
    else lines.push({ y: word.y, words: [word], text: "" });
  }
  return lines
    .sort((left, right) => right.y - left.y)
    .map((line) => ({ ...line, text: line.words.sort((left, right) => left.x - right.x).map((word) => word.text).join(" ").trim() }));
}

function parseLocationLine(line: string) {
  const usMatch = line.match(/^(.+?)\s+([A-Z]{2})\s+(\d{5}(?:-\d{4})?)$/);
  if (usMatch) return { city: usMatch[1]!.trim(), state: usMatch[2]!, postalCode: usMatch[3]! };
  const caMatch = line.match(/^(.+?)\s+([A-Z]{2})\s+([A-Z]\d[A-Z]\s?\d[A-Z]\d)$/i);
  if (caMatch) return { city: caMatch[1]!.trim(), state: caMatch[2]!.toUpperCase(), postalCode: caMatch[3]!.toUpperCase() };
  return null;
}

function looksLikeStreetAddress(line: string) {
  return /^\d+\s+\S/.test(line) || /^(P\.?O\.?|RR)\s+/i.test(line);
}

function readCountryCode(value: string | undefined) {
  if (/^United States$/i.test(value ?? "")) return "US";
  if (/^Canada$/i.test(value ?? "")) return "CA";
  return null;
}

function parsePackingSlipDate(text: string) {
  const value = text.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4}\b/i)?.[0];
  if (!value) return null;
  const timestamp = Date.parse(`${value} 00:00:00 UTC`);
  return Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString().slice(0, 10);
}

function readSectionText(text: string, startLabel: string, endLabel: string) {
  const normalized = text.replace(/\r/g, "");
  const start = normalized.toUpperCase().indexOf(startLabel.toUpperCase());
  if (start < 0) return null;
  const contentStart = start + startLabel.length;
  const end = normalized.toUpperCase().indexOf(endLabel.toUpperCase(), contentStart);
  const value = normalized.slice(contentStart, end >= 0 ? end : undefined).replace(/\s+/g, " ").trim();
  return value || null;
}

function readDocumentCustomerReference(text: string) {
  const preferred = [
    /MASTER\s+BOL\s*:\s*(US\d{4,})/i,
    /BOL#\s*:\s*(US\d{4,})/i,
    /PO#\s*:\s*(US\d{4,})/i
  ];
  for (const pattern of preferred) {
    const match = text.match(pattern)?.[1];
    if (match) return match.toUpperCase();
  }
  return normalizeCustomerReference(text.match(CUSTOMER_REFERENCE_PATTERN)?.[0]);
}

function readBolCarrier(text: string) {
  if (/\bEstes\b|\bEXLA\b/i.test(text)) return "Estes";
  return null;
}

function isPdfAttachment(attachment: TmgSourcePdfAttachment) {
  const fileNameIsPdf = attachment.fileName.toLowerCase().endsWith(".pdf");
  const contentTypeIsPdf = attachment.contentType?.toLowerCase() === "application/pdf";
  return (fileNameIsPdf || contentTypeIsPdf) && Buffer.from(attachment.bytes.subarray(0, 5)).toString("ascii") === "%PDF-";
}

function isBetween(value: number, first: number, second: number) {
  return value <= Math.max(first, second) && value >= Math.min(first, second);
}

function normalizeCustomerReference(value: string | undefined | null) {
  const normalized = value?.trim().toUpperCase() ?? "";
  return /^US\d{4,}$/.test(normalized) ? normalized : null;
}

function normalizeText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function findDuplicateValues(values: string[]) {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return duplicates;
}

async function extractPositionedPdfPages(fileBytes: Uint8Array): Promise<PositionedPage[]> {
  const textExtraction = await extractPdfTextPagesFromBytes(fileBytes);
  const pdfjs = (await import("pdfjs-dist/legacy/build/pdf.mjs")) as {
    getDocument(options: { data: Uint8Array; disableWorker: boolean }): {
      promise: Promise<{
        numPages: number;
        getPage(pageNumber: number): Promise<{
          getViewport(options: { scale: number }): { width: number; height: number };
          getTextContent(): Promise<{ items: Array<{ str?: string; transform?: unknown[] }> }>;
        }>;
      }>;
    };
  };
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(fileBytes), disableWorker: true }).promise;
  const pages: PositionedPage[] = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    pages.push({
      pageNumber,
      width: viewport.width,
      height: viewport.height,
      text: textExtraction.pages[pageNumber - 1]?.text ?? "",
      words: content.items.flatMap((item) => {
        const text = item.str?.trim();
        if (!text) return [];
        const transform = Array.isArray(item.transform) ? item.transform : [];
        return [{ text, x: Number(transform[4] ?? 0), y: Number(transform[5] ?? 0) }];
      })
    });
  }
  return pages;
}
