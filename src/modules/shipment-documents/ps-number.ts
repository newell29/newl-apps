export type ShipmentDocumentType = "BOL" | "PICK_TICKET";
export type ShipmentPageDetectionMethod = "TEXT" | "AI" | "INHERITED";

export type DetectedShipmentPage = {
  pageNumber: number;
  psNumber: string | null;
  detectionMethod: "TEXT" | "AI";
  confidence: string;
  notes: string | null;
};

export type GroupedShipmentPage = {
  pageNumber: number;
  psNumber: string;
  detectionMethod: ShipmentPageDetectionMethod;
  confidence: string;
  notes: string | null;
};

export const PS_NUMBER_PATTERN = /\bPS[-\s]?(\d{5,8})\b/i;

export function extractPsNumberFromText(text: string | null | undefined) {
  if (!text) {
    return null;
  }

  const compact = text.replace(/\s+/g, " ").trim();
  const match = compact.match(PS_NUMBER_PATTERN);

  if (!match) {
    return null;
  }

  return `PS${match[1]}`;
}

export function normalizePsNumber(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const compact = value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const match = compact.match(/^PS(\d{5,8})$/);

  if (!match) {
    return null;
  }

  return `PS${match[1]}`;
}

export function comparePsNumbers(a: string, b: string) {
  return readPsNumericValue(a) - readPsNumericValue(b);
}

export function readPsNumericValue(value: string) {
  const normalized = normalizePsNumber(value);
  return normalized ? Number.parseInt(normalized.slice(2), 10) : Number.POSITIVE_INFINITY;
}

export function formatHumanDateFromIso(isoDate: string) {
  const date = new Date(`${isoDate}T00:00:00`);

  return new Intl.DateTimeFormat("en-CA", {
    month: "long",
    day: "numeric",
    year: "numeric"
  }).format(date);
}

export function sanitizeLabelForFilename(label: string) {
  const cleaned = label
    .trim()
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ");

  return cleaned.length > 0 ? cleaned : "Shipment Documents";
}

export function groupDetectedShipmentPages(
  documentType: ShipmentDocumentType,
  pages: DetectedShipmentPage[]
) {
  if (documentType !== "BOL") {
    return pages.map((page) => {
      if (!page.psNumber) {
        throw new Error(`Could not find a PS number on ${documentType} page ${page.pageNumber}.`);
      }

      return {
        psNumber: page.psNumber,
        pages: [
          {
            pageNumber: page.pageNumber,
            psNumber: page.psNumber,
            detectionMethod: page.detectionMethod,
            confidence: page.confidence,
            notes: page.notes
          }
        ]
      };
    });
  }

  const groups: Array<{ psNumber: string; pages: GroupedShipmentPage[] }> = [];

  for (const page of pages) {
    const currentGroup = groups.at(-1) ?? null;

    if (page.psNumber) {
      if (currentGroup && currentGroup.psNumber === page.psNumber) {
        currentGroup.pages.push({
          pageNumber: page.pageNumber,
          psNumber: page.psNumber,
          detectionMethod: page.detectionMethod,
          confidence: page.confidence,
          notes: page.notes
        });
        continue;
      }

      groups.push({
        psNumber: page.psNumber,
        pages: [
          {
            pageNumber: page.pageNumber,
            psNumber: page.psNumber,
            detectionMethod: page.detectionMethod,
            confidence: page.confidence,
            notes: page.notes
          }
        ]
      });
      continue;
    }

    if (!currentGroup) {
      throw new Error(`Could not find a PS number on BOL page ${page.pageNumber}.`);
    }

    currentGroup.pages.push({
      pageNumber: page.pageNumber,
      psNumber: currentGroup.psNumber,
      detectionMethod: "INHERITED",
      confidence: "GROUPED",
      notes: "Grouped with the previous BOL page that started the same shipment document."
    });
  }

  return groups;
}
