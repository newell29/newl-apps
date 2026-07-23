import { mkdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

import {
  buildSpreadsheetWorkbook,
  normalizeSpreadsheetInput,
  type SpreadsheetInput
} from "../plugins/newl-teamship/src/spreadsheet.ts";

type CompletionResponse = {
  data?: {
    reports?: {
      keywordImport?: SpreadsheetInput;
      performance?: SpreadsheetInput;
    };
  };
};

const [, , responsePath, outputDirectory] = process.argv;
if (!responsePath || !outputDirectory || !isAbsolute(outputDirectory)) {
  throw new Error("Usage: create-website-growth-reports.ts <completion-response.json> <absolute-output-directory>");
}

const response = JSON.parse(await readFile(responsePath, "utf8")) as CompletionResponse;
const keywordImport = normalizeSpreadsheetInput(requireReport(response, "keywordImport"));
const performance = normalizeSpreadsheetInput(requireReport(response, "performance"));
await mkdir(outputDirectory, { recursive: true, mode: 0o700 });

const keywordImportPath = join(outputDirectory, keywordImport.filename);
const performancePath = join(outputDirectory, performance.filename);
await writeFile(keywordImportPath, buildSpreadsheetWorkbook(keywordImport), { mode: 0o600 });
await writeFile(performancePath, buildSpreadsheetWorkbook(performance), { mode: 0o600 });

process.stdout.write(JSON.stringify({
  keywordImport: {
    path: keywordImportPath,
    filename: keywordImport.filename,
    rowCount: keywordImport.rows.length
  },
  performance: {
    path: performancePath,
    filename: performance.filename,
    rowCount: performance.rows.length
  }
}));

function requireReport(
  response: CompletionResponse,
  key: "keywordImport" | "performance"
) {
  const report = response.data?.reports?.[key];
  if (!report) throw new Error(`Website Growth completion did not include the ${key} report.`);
  return report;
}
