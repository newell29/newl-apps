async function main() {
  const baseUrl = process.env.NEWL_APPS_BASE_URL?.trim()?.replace(/\/+$/, "");
  const token = process.env.OPENCLAW_TEAMSHIP_READ_TOKEN?.trim();
  const userEmail = readArgument("--user-email") ?? process.env.NEWL_USER_EMAIL?.trim();
  const prompt = readPrompt();

  if (!baseUrl || !token || !userEmail || !prompt) {
    console.error(
      "NEWL_APPS_BASE_URL, OPENCLAW_TEAMSHIP_READ_TOKEN, --user-email (or NEWL_USER_EMAIL), and a prompt are required."
    );
    process.exitCode = 1;
    return;
  }

  const response = await fetch(`${baseUrl}/api/assistant/teamship/read`, {
    method: "POST",
    redirect: "manual",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "x-newl-user-email": userEmail
    },
    body: JSON.stringify({ prompt })
  });
  const responseText = await response.text();
  const body = parseResponseBody(responseText, response);
  if (!body) {
    process.exitCode = 1;
    return;
  }

  const result = body as {
    data?: { answer?: string; sources?: Array<{ title?: string }> };
    error?: string;
  };
  if (!response.ok || !result.data?.answer) {
    console.error(result.error || `Newl Apps returned HTTP ${response.status}.`);
    process.exitCode = 1;
  } else {
    console.log(result.data.answer);
    const titles = (result.data.sources ?? []).map((source) => source.title).filter(Boolean);
    if (titles.length > 0) {
      console.log(`Sources: ${titles.join("; ")}`);
    }
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "OpenClaw Teamship read failed.");
  process.exitCode = 1;
});

function parseResponseBody(responseText: string, response: Response) {
  try {
    return JSON.parse(responseText) as unknown;
  } catch {
    const redirectLocation = response.headers.get("location");
    const detail = redirectLocation ? ` Redirected to ${redirectLocation}.` : "";
    console.error(`Newl Apps returned HTTP ${response.status} with a non-JSON response.${detail}`);
    return null;
  }
}

function readArgument(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1]?.trim() || null : null;
}

function readPrompt() {
  const separatorIndex = process.argv.indexOf("--");
  if (separatorIndex >= 0) {
    return process.argv.slice(separatorIndex + 1).join(" ").trim() || null;
  }

  const skipped = new Set<number>();
  for (let index = 2; index < process.argv.length; index += 1) {
    if (process.argv[index] === "--user-email") {
      skipped.add(index);
      skipped.add(index + 1);
    }
  }
  return process.argv.slice(2).filter((_, index) => !skipped.has(index + 2)).join(" ").trim() || null;
}
