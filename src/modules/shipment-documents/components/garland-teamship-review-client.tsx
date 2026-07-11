"use client";

import type { PDFPageProxy } from "pdfjs-dist/types/src/display/api";
import { useMemo, useState } from "react";

import { parseGarlandShippingOrderPages, parseTeamshipAlertDigest } from "@/modules/shipment-documents/teamship-review";
import type {
  GarlandPdfShippingOrder,
  GarlandTeamshipReviewResponse,
  TeamshipShippingOrderDetail
} from "@/modules/shipment-documents/teamship-review-types";

type PdfJsModule = typeof import("pdfjs-dist");

type DailyOrdersResponse = {
  orders?: TeamshipShippingOrderDetail[];
  totalCount?: number;
  error?: string;
};

let pdfJsLoader: Promise<PdfJsModule> | null = null;

export function GarlandTeamshipReviewClient() {
  const [shipmentDate, setShipmentDate] = useState(getTodayInputValue());
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [orders, setOrders] = useState<GarlandPdfShippingOrder[]>([]);
  const [review, setReview] = useState<GarlandTeamshipReviewResponse | null>(null);
  const [dailyOrderCount, setDailyOrderCount] = useState<number | null>(null);
  const [teamshipEmail, setTeamshipEmail] = useState("");
  const [teamshipPassword, setTeamshipPassword] = useState("");
  const [alertDigest, setAlertDigest] = useState("");
  const [status, setStatus] = useState("Upload the Garland daily shipping-order PDF to begin.");
  const [error, setError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const extractedSummary = useMemo(() => {
    if (orders.length === 0) {
      return "No PDF orders extracted yet.";
    }

    return `${orders.length} PDF order${orders.length === 1 ? "" : "s"} extracted: ${orders
      .map((order) => order.srNumber)
      .join(", ")}`;
  }, [orders]);

  const parsedAlertCount = useMemo(() => parseTeamshipAlertDigest(alertDigest).length, [alertDigest]);

  async function handlePdfSelection(file: File | null) {
    setPdfFile(file);
    setOrders([]);
    setReview(null);
    setDailyOrderCount(null);
    setError(null);

    if (!file) {
      setStatus("Upload the Garland daily shipping-order PDF to begin.");
      return;
    }

    setIsProcessing(true);
    setStatus("Reading embedded PDF text from Garland shipping orders...");

    try {
      const parsedOrders = await extractOrdersFromPdf(file);
      setOrders(parsedOrders);
      setStatus(
        parsedOrders.length > 0
          ? `Ready to review ${parsedOrders.length} Garland order${parsedOrders.length === 1 ? "" : "s"} against Teamship.`
          : "No Garland PS/SR orders were found in this PDF."
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to read the Garland PDF.");
      setStatus("PDF extraction stopped before Teamship review.");
    } finally {
      setIsProcessing(false);
    }
  }

  async function runReview() {
    setError(null);
    setReview(null);

    let extractedOrders = orders;

    try {
      if (extractedOrders.length === 0 && pdfFile) {
        setIsProcessing(true);
        setStatus("Extracting PDF orders before Teamship review...");
        extractedOrders = await extractOrdersFromPdf(pdfFile);
        setOrders(extractedOrders);
      }

      if (extractedOrders.length === 0) {
        throw new Error("Upload a Garland shipping-order PDF with at least one PS/SR order before running the review.");
      }

      setIsProcessing(true);
      setStatus("Fetching Teamship orders and comparing reviewed fields...");

      const response = await fetch("/api/shipment-documents/teamship-review/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          shipmentDate,
          orders: extractedOrders,
          alertDigest,
          teamshipCredentials: getOneTimeCredentials(teamshipEmail, teamshipPassword)
        })
      });
      const json = (await response.json().catch(() => null)) as unknown;

      if (!response.ok || isErrorResponse(json)) {
        throw new Error(isErrorResponse(json) ? json.error : "Unable to run the Teamship review.");
      }

      if (!isReviewResponse(json)) {
        throw new Error("Teamship review returned an unexpected response.");
      }

      setReview(json);
      setStatus(
        `Review complete: ${json.summary.passedCount} green, ${json.summary.pendingTeamshipCount} pending Teamship creation, ${json.summary.failedCount} with discrepancies, ${json.summary.missingTeamshipCount} missing without an alert.`
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to run the Teamship review.");
      setStatus("Teamship review stopped before results were created.");
    } finally {
      setIsProcessing(false);
    }
  }

  async function fetchDailyOrders() {
    setError(null);
    setDailyOrderCount(null);
    setIsProcessing(true);
    setStatus("Fetching Garland Canada Distribution orders from Teamship for the selected day...");

    try {
      const response = await fetch("/api/shipment-documents/teamship-review/daily-orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          shipmentDate,
          teamshipCredentials: getOneTimeCredentials(teamshipEmail, teamshipPassword)
        })
      });
      const json = (await response.json().catch(() => null)) as DailyOrdersResponse | null;

      if (!response.ok || !json) {
        throw new Error(json?.error ?? "Unable to fetch Teamship daily orders.");
      }

      setDailyOrderCount(json.totalCount ?? json.orders?.length ?? 0);
      setStatus(`Fetched ${json.totalCount ?? json.orders?.length ?? 0} Teamship Garland order(s) for ${shipmentDate}.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to fetch Teamship daily orders.");
      setStatus("Teamship daily-order pull stopped.");
    } finally {
      setIsProcessing(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <div className="grid gap-4 lg:grid-cols-2">
          <label className="space-y-2 text-sm font-semibold text-foreground">
            Review date
            <input
              type="date"
              value={shipmentDate}
              onChange={(event) => setShipmentDate(event.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </label>
          <label className="space-y-2 text-sm font-semibold text-foreground">
            Garland shipping-order PDF
            <input
              type="file"
              accept="application/pdf"
              onChange={(event) => void handlePdfSelection(event.target.files?.[0] ?? null)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </label>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void runReview()}
            disabled={isProcessing || !pdfFile}
            className="rounded-md bg-primary px-5 py-2.5 text-sm font-semibold text-primaryForeground transition-colors hover:bg-primaryHover disabled:cursor-not-allowed disabled:opacity-60"
          >
            Run Teamship review
          </button>
          <button
            type="button"
            onClick={() => void fetchDailyOrders()}
            disabled={isProcessing}
            className="rounded-md border border-border px-5 py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
          >
            Fetch Teamship daily orders
          </button>
          <p className="text-sm text-mutedForeground">{status}</p>
        </div>

        {error ? (
          <div className="mt-4 rounded-md border border-danger/30 bg-danger/10 px-4 py-3 text-sm font-medium text-danger">
            {error}
          </div>
        ) : null}
      </section>

      <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <div className="grid gap-4 xl:grid-cols-[0.9fr,1.1fr]">
          <div>
            <h2 className="text-base font-semibold text-foreground">One-time Teamship login</h2>
            <p className="mt-1 text-sm leading-6 text-mutedForeground">
              Optional fallback for manual testing when server Teamship credentials are not configured. These values are
              sent only with the current manual request, are not saved to Newl Apps history, and are not used by the
              cron-ready daily sync endpoint.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-2 text-sm font-semibold text-foreground">
              Teamship email
              <input
                type="email"
                autoComplete="off"
                value={teamshipEmail}
                onChange={(event) => setTeamshipEmail(event.target.value)}
                placeholder="name@example.com"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </label>
            <label className="space-y-2 text-sm font-semibold text-foreground">
              Teamship password
              <input
                type="password"
                autoComplete="off"
                value={teamshipPassword}
                onChange={(event) => setTeamshipPassword(event.target.value)}
                placeholder="Only used for this manual request"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </label>
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <div className="grid gap-4 xl:grid-cols-[0.9fr,1.1fr]">
          <div>
            <h2 className="text-base font-semibold text-foreground">Teamship alert digest</h2>
            <p className="mt-1 text-sm leading-6 text-mutedForeground">
              Optional: paste the hourly Teamship Alert Digest here. If a Garland PDF order is not in Teamship yet but
              appears in the digest, it will show amber as pending creation instead of red as an unexplained missing
              order.
            </p>
            <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-mutedForeground">
              {parsedAlertCount} alert order{parsedAlertCount === 1 ? "" : "s"} detected
            </p>
          </div>
          <label className="space-y-2 text-sm font-semibold text-foreground">
            Paste alert email text
            <textarea
              value={alertDigest}
              onChange={(event) => setAlertDigest(event.target.value)}
              placeholder="Teamship Alert Digest&#10;&#10;Shipping Orders — Out of Stock (4)&#10;&#10;Order SR811861..."
              className="min-h-44 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </label>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <SummaryCard label="PDF extraction" value={String(orders.length)} detail={extractedSummary} />
        <SummaryCard
          label="Teamship daily pull"
          value={dailyOrderCount === null ? "Not run" : String(dailyOrderCount)}
          detail="Manual pull is available now. The 15-minute cron remains intentionally disabled."
        />
        <SummaryCard
          label="Review result"
          value={review ? `${review.summary.passedCount}/${review.summary.pdfOrderCount} green` : "Not run"}
          detail={
            review
              ? `${review.summary.pendingTeamshipCount} pending, ${review.summary.failedCount} discrepancy, ${review.summary.missingTeamshipCount} missing without alert.`
              : "Run the review after uploading the Garland PDF."
          }
        />
      </section>

      {orders.length > 0 ? <ExtractedOrdersTable orders={orders} /> : null}
      {review ? <ReviewResultsTable review={review} /> : null}
    </div>
  );
}

function SummaryCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-mutedForeground">{label}</p>
      <p className="mt-2 text-2xl font-bold text-foreground">{value}</p>
      <p className="mt-2 text-sm leading-5 text-mutedForeground">{detail}</p>
    </div>
  );
}

function ExtractedOrdersTable({ orders }: { orders: GarlandPdfShippingOrder[] }) {
  return (
    <section className="rounded-lg border border-border bg-card shadow-sm">
      <div className="border-b border-border p-5">
        <h2 className="text-base font-semibold text-foreground">Extracted Garland PDF orders</h2>
        <p className="mt-1 text-sm text-mutedForeground">
          This is the order list the app will use to fetch matching Teamship shipment IDs.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-muted/50 text-xs uppercase tracking-wide text-mutedForeground">
            <tr>
              <th className="px-4 py-3">Pages</th>
              <th className="px-4 py-3">PS</th>
              <th className="px-4 py-3">SR</th>
              <th className="px-4 py-3">Ship via</th>
              <th className="px-4 py-3">Ship to</th>
              <th className="px-4 py-3">Items</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {orders.map((order) => (
              <tr key={`${order.psNumber}-${order.srNumber}`}>
                <td className="px-4 py-3 text-mutedForeground">{order.pageNumbers.join(", ")}</td>
                <td className="px-4 py-3 font-semibold text-foreground">{order.psNumber}</td>
                <td className="px-4 py-3 font-semibold text-foreground">{order.srNumber}</td>
                <td className="px-4 py-3">{order.shipVia ?? "Missing"}</td>
                <td className="px-4 py-3">
                  <div className="font-medium text-foreground">{order.shipToName ?? "Missing"}</div>
                  <div className="text-mutedForeground">
                    {[order.shipToCity, order.shipToState, order.shipToPostalCode].filter(Boolean).join(", ")}
                  </div>
                </td>
                <td className="px-4 py-3 text-mutedForeground">{order.items.map((item) => item.sku).join(", ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ReviewResultsTable({ review }: { review: GarlandTeamshipReviewResponse }) {
  return (
    <section className="rounded-lg border border-border bg-card shadow-sm">
      <div className="border-b border-border p-5">
        <h2 className="text-base font-semibold text-foreground">Teamship review results</h2>
        <p className="mt-1 text-sm text-mutedForeground">
          Green orders have no detected discrepancies. Amber orders are known Teamship alert items that have not been
          pushed into Teamship yet. Red orders need CSR review before Stage 2 automation updates them.
        </p>
      </div>
      <div className="divide-y divide-border">
        {review.reviews.map((orderReview) => (
          <details key={`${orderReview.psNumber}-${orderReview.srNumber}`} open={orderReview.status !== "PASS"}>
            <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-3 px-5 py-4">
              <div>
                <span className="font-semibold text-foreground">
                  {orderReview.psNumber} / {orderReview.srNumber}
                </span>
                <span className="ml-3 text-sm text-mutedForeground">PDF page(s) {orderReview.pageNumbers.join(", ")}</span>
              </div>
              <span
                className={[
                  "rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wide",
                  orderReview.status === "PASS"
                    ? "bg-success/10 text-success"
                    : orderReview.status === "MISSING_TEAMSHIP"
                      ? "bg-danger/10 text-danger"
                      : "bg-warning/15 text-warning"
                ].join(" ")}
              >
                {orderReview.status === "PASS"
                  ? "Green"
                  : orderReview.status === "MISSING_TEAMSHIP"
                    ? "Missing Teamship"
                    : orderReview.status === "PENDING_TEAMSHIP"
                      ? "Pending Teamship"
                      : `${orderReview.issueCount} issue${orderReview.issueCount === 1 ? "" : "s"}`}
              </span>
            </summary>
            <div className="overflow-x-auto px-5 pb-5">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-muted/40 text-xs uppercase tracking-wide text-mutedForeground">
                  <tr>
                    <th className="px-3 py-2">Field</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Garland PDF</th>
                    <th className="px-3 py-2">Teamship</th>
                    <th className="px-3 py-2">Note</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {orderReview.fields.map((field) => (
                    <tr key={field.key}>
                      <td className="px-3 py-2 font-medium text-foreground">{field.label}</td>
                      <td className="px-3 py-2">
                        <span className={statusPillClass(field.status)}>{formatFieldStatus(field.status)}</span>
                      </td>
                      <td className="max-w-xs px-3 py-2 text-mutedForeground">{field.pdfValue ?? "Blank"}</td>
                      <td className="max-w-xs px-3 py-2 text-mutedForeground">{field.teamshipValue ?? "Blank"}</td>
                      <td className="px-3 py-2 text-mutedForeground">{field.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        ))}
      </div>
    </section>
  );
}

function statusPillClass(status: string) {
  const base = "rounded-full px-2 py-0.5 text-xs font-bold uppercase tracking-wide";

  if (status === "MATCH") {
    return `${base} bg-success/10 text-success`;
  }

  if (status === "INFO") {
    return `${base} bg-muted text-mutedForeground`;
  }

  if (status === "PENDING") {
    return `${base} bg-warning/15 text-warning`;
  }

  return `${base} bg-danger/10 text-danger`;
}

function formatFieldStatus(status: string) {
  return status === "MATCH"
    ? "Match"
    : status === "INFO"
      ? "Info"
      : status === "MISSING"
        ? "Missing"
        : status === "PENDING"
          ? "Pending"
          : "Issue";
}

function isErrorResponse(value: unknown): value is { error: string } {
  return Boolean(value && typeof value === "object" && "error" in value && typeof value.error === "string");
}

function isReviewResponse(value: unknown): value is GarlandTeamshipReviewResponse {
  return Boolean(
    value &&
      typeof value === "object" &&
      "summary" in value &&
      "reviews" in value &&
      Array.isArray((value as GarlandTeamshipReviewResponse).reviews)
  );
}

async function extractOrdersFromPdf(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const pdf = await loadPdf(bytes);
  const pages: Array<{ pageNumber: number; text: string }> = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    pages.push({
      pageNumber,
      text: await extractPageText(page)
    });
  }

  return parseGarlandShippingOrderPages(pages);
}

async function loadPdf(fileBytes: Uint8Array) {
  const pdfjs = await loadPdfJs();
  const bytes = new Uint8Array(fileBytes.byteLength);
  bytes.set(fileBytes);

  return pdfjs.getDocument({
    data: bytes,
    cMapPacked: true,
    cMapUrl: "/pdfjs/cmaps/",
    standardFontDataUrl: "/pdfjs/standard_fonts/",
    wasmUrl: "/pdfjs/wasm/"
  }).promise;
}

async function loadPdfJs() {
  if (!pdfJsLoader) {
    pdfJsLoader = import("pdfjs-dist").then((module) => {
      module.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
      return module;
    });
  }

  return pdfJsLoader;
}

async function extractPageText(page: PDFPageProxy) {
  const textContent = await page.getTextContent();
  const items = textContent.items
    .map((item) => {
      if (!("str" in item) || !item.str.trim()) {
        return null;
      }

      const transform = "transform" in item && Array.isArray(item.transform) ? item.transform : [];
      return {
        text: item.str,
        x: Number(transform[4] ?? 0),
        y: Number(transform[5] ?? 0)
      };
    })
    .filter((item): item is { text: string; x: number; y: number } => Boolean(item))
    .sort((left, right) => {
      const yDiff = right.y - left.y;
      return Math.abs(yDiff) > 3 ? yDiff : left.x - right.x;
    });
  const lines: Array<{ y: number; parts: string[] }> = [];

  for (const item of items) {
    const line = lines.find((candidate) => Math.abs(candidate.y - item.y) <= 3);

    if (line) {
      line.parts.push(item.text);
      continue;
    }

    lines.push({ y: item.y, parts: [item.text] });
  }

  return lines.map((line) => line.parts.join(" ").replace(/\s+/g, " ").trim()).join("\n");
}

function getTodayInputValue() {
  const now = new Date();
  const offsetMs = now.getTimezoneOffset() * 60 * 1000;
  return new Date(now.getTime() - offsetMs).toISOString().slice(0, 10);
}

function getOneTimeCredentials(email: string, password: string) {
  const trimmedEmail = email.trim();
  const trimmedPassword = password.trim();

  if (!trimmedEmail && !trimmedPassword) {
    return undefined;
  }

  if (!trimmedEmail || !trimmedPassword) {
    return undefined;
  }

  return {
    email: trimmedEmail,
    password: trimmedPassword
  };
}
