import { readFile } from "node:fs/promises";
import path from "node:path";
import { buildLtlRateRequestFromParsedInquiry } from "@/modules/tms-bridge/ltl-inquiry-rate-request";
import { parseEmailWithOpenAI, type ParsedEmailLogisticsData } from "@/modules/tms-bridge/actions";

type SanitizedParsedReport = {
  parsedOrigin: string;
  parsedDestination: string;
  originPostalCode: string;
  destinationPostalCode: string;
  originCountry: string;
  destinationCountry: string;
  parsedFreightPieces: Array<{
    quantity: string;
    packagingType: string;
    length: string;
    width: string;
    height: string;
    weight: string;
    weightType: string;
    freightClass: string;
    nmfc: string;
    unNumber: string;
    stackable: string;
  }>;
  freightClass: string;
  accessorialWording: string[];
  stackableValue: string;
  hazmatValue: boolean;
};

async function main() {
  const inputPath = process.argv[2];
  if (!inputPath) {
    throw new Error(
      "Usage: node --import tsx --env-file=.env scripts/prove-ltl-email-parser-adapter.ts <path-to-local-email-text-file>"
    );
  }

  const absoluteInputPath = path.resolve(process.cwd(), inputPath);
  const inquiryText = await readFile(absoluteInputPath, "utf8");
  const parsedJson = await parseEmailWithOpenAI(inquiryText);
  const parsed = JSON.parse(parsedJson) as ParsedEmailLogisticsData;
  const adapterResult = buildLtlRateRequestFromParsedInquiry(parsed);

  const report = {
    inputFile: absoluteInputPath,
    parserOutput: sanitizeParsedReport(parsed),
    adapterOutput: {
      canRequestRates: adapterResult.canRequestRates,
      missingRequiredFields: adapterResult.missingRequiredFields,
      appliedDefaults: adapterResult.appliedDefaults,
      detectedAccessorials: adapterResult.detectedAccessorials,
      unsupportedOrUnmappedTerms: adapterResult.unsupportedOrUnmappedTerms,
      warnings: adapterResult.warnings,
      generatedLtlQuoteRequest: adapterResult.request
    }
  };

  console.log(JSON.stringify(report, null, 2));
}

function sanitizeParsedReport(parsed: ParsedEmailLogisticsData): SanitizedParsedReport {
  return {
    parsedOrigin: parsed.origin,
    parsedDestination: parsed.destination,
    originPostalCode: parsed.originPostalCode,
    destinationPostalCode: parsed.destinationPostalCode,
    originCountry: parsed.originCountry,
    destinationCountry: parsed.destinationCountry,
    parsedFreightPieces: parsed.items.map((item) => ({
      quantity: item.quantity,
      packagingType: item.packagingType,
      length: item.length,
      width: item.width,
      height: item.height,
      weight: item.weight,
      weightType: item.weightType,
      freightClass: item.freightClass,
      nmfc: item.nmfc,
      unNumber: item.unNumber,
      stackable: item.stackable
    })),
    freightClass: parsed.freightClass,
    accessorialWording: parsed.accessorials,
    stackableValue: parsed.stackable,
    hazmatValue: parsed.dangerousGoods
  };
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
