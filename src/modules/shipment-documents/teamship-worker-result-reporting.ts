export type TeamshipWorkerCompletionStatus = "SUCCESS" | "FAILED" | "NEEDS_REVIEW";

type FetchLike = typeof fetch;

type ResultReportingRetry = {
  attempt: number;
  delayMs: number;
  error: Error;
};

export class TeamshipWorkerResultReportingError extends Error {
  readonly statusCode: number | null;
  readonly retryable: boolean;

  constructor(message: string, { statusCode, retryable }: { statusCode?: number | null; retryable: boolean }) {
    super(message);
    this.name = "TeamshipWorkerResultReportingError";
    this.statusCode = statusCode ?? null;
    this.retryable = retryable;
  }
}

export async function reportTeamshipWorkerResultWithRetry<T>({
  baseUrl,
  token,
  agentId,
  jobId,
  status,
  result,
  fetchImpl = fetch,
  sleep = defaultSleep,
  onRetry,
  maxAttempts = Number.POSITIVE_INFINITY
}: {
  baseUrl: string;
  token: string;
  agentId: string;
  jobId: string;
  status: TeamshipWorkerCompletionStatus;
  result: unknown;
  fetchImpl?: FetchLike;
  sleep?: (delayMs: number) => Promise<void>;
  onRetry?: (retry: ResultReportingRetry) => void;
  maxAttempts?: number;
}): Promise<T> {
  const requestBody = JSON.stringify({ status, result });
  let attempt = 0;

  while (attempt < maxAttempts) {
    attempt += 1;

    try {
      const response = await fetchImpl(
        `${baseUrl.replace(/\/+$/, "")}/api/shipment-documents/teamship-review/update-jobs/agent/${encodeURIComponent(jobId)}`,
        {
          method: "PATCH",
          headers: {
            authorization: `Bearer ${token}`,
            "x-newl-agent-id": agentId,
            "content-type": "application/json"
          },
          body: requestBody
        }
      );
      const responseText = await response.text();
      const json = parseJsonResponse<T & { error?: string }>(responseText);

      if (!response.ok) {
        throw new TeamshipWorkerResultReportingError(
          json?.error ?? `Unable to report Teamship update result. HTTP ${response.status}.`,
          {
            statusCode: response.status,
            retryable: isTransientHttpStatus(response.status)
          }
        );
      }

      if (!json) {
        throw new TeamshipWorkerResultReportingError(
          `Unable to report Teamship update result. Expected JSON but received HTTP ${response.status} ${describeResponseBody(responseText)}.`,
          {
            statusCode: response.status,
            retryable: false
          }
        );
      }

      return json;
    } catch (error) {
      const reportingError = normalizeReportingError(error);

      if (!reportingError.retryable || attempt >= maxAttempts) {
        throw reportingError;
      }

      const delayMs = retryDelayMs(attempt);
      onRetry?.({ attempt, delayMs, error: reportingError });
      await sleep(delayMs);
    }
  }

  throw new TeamshipWorkerResultReportingError("Unable to report Teamship update result.", { retryable: false });
}

function normalizeReportingError(error: unknown) {
  if (error instanceof TeamshipWorkerResultReportingError) {
    return error;
  }

  return new TeamshipWorkerResultReportingError(
    error instanceof Error ? error.message : "The Newl Apps result callback ended without a response.",
    { retryable: true }
  );
}

function isTransientHttpStatus(status: number) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function retryDelayMs(failedAttempt: number) {
  return Math.min(30_000, 500 * 2 ** Math.max(0, failedAttempt - 1));
}

function parseJsonResponse<T>(value: string) {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function describeResponseBody(value: string) {
  const preview = value.replace(/\s+/g, " ").trim().slice(0, 120);
  return preview ? `with body starting: ${JSON.stringify(preview)}` : "with an empty response body";
}

function defaultSleep(delayMs: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, delayMs));
}
