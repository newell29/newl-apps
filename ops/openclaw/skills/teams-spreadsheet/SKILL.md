---
name: teams-spreadsheet
description: "Create and deliver a downloadable Excel .xlsx attachment in the current Microsoft Teams direct message. Use when an authenticated employee explicitly asks Nemo to turn already-authorized results or a table from the current conversation into a spreadsheet."
---

# Teams Spreadsheet

Create a spreadsheet only from data the employee is already authorized to see and that was returned or assembled in the current conversation. Do not broaden a data lookup, add hidden columns, or infer missing operational values merely to fill the workbook.

## Create and deliver

1. Define explicit columns with stable letter-led keys and employee-friendly headers. Keep no more than 25 columns and 500 rows.
2. Call `newl_create_spreadsheet` with a short filename, one sheet name, the columns, and the rows. Use text, finite numbers, booleans, or null only.
3. When creation succeeds, immediately call `message` with:
   - `action: "upload-file"`
   - `channel: "msteams"`
   - the exact `filePath` and `filename` returned by the tool
   - a short message describing the attached workbook
4. Omit `to` so OpenClaw uses the trusted current Teams direct-message target. Never send the file to a different person, group, or channel from this workflow.
5. After the upload action succeeds, say briefly that the Excel file was attached. If Teams returns a pending upload/consent result, explain that the recipient must accept the file card before the upload completes.

## Failure handling

Never return a local filesystem path, `file://` URL, or Markdown link to the generated file. A path on the OpenClaw Mac is not downloadable from Teams.

If creation or upload fails, state that the spreadsheet was not delivered and include the safe tool error. Do not claim success, substitute CSV text, retry to another target, or expose the local path. The unresolved-turn capture will place the failure in Rivet's review queue.

Do not use `exec`, browser automation, SharePoint, email, or a public link as a fallback.
