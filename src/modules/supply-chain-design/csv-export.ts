const SPREADSHEET_FORMULA_PREFIX = /^[\u0000-\u0020\uFEFF]*[=+\-@]/u;
const PLAIN_SIGNED_NUMBER = /^[+\-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+\-]?\d+)?$/u;

export function escapeSpreadsheetCsvCell(value: string) {
  const formulaCandidate = value.replace(/^[\u0000-\u0020\uFEFF]*/u, "");
  const safeValue =
    SPREADSHEET_FORMULA_PREFIX.test(value) && !PLAIN_SIGNED_NUMBER.test(formulaCandidate)
      ? `'${value}`
      : value;

  return /[",\n\r]/u.test(safeValue)
    ? `"${safeValue.replace(/"/g, '""')}"`
    : safeValue;
}
