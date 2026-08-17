"use client";

import { useCallback, useEffect, useState } from "react";

import type { TmgOrderIntakeSettings } from "@/modules/shipment-documents/tmg-settings";

export function TmgOrderIntakeClient({
  initialSettings,
  canConfigure,
  canApprove
}: {
  initialSettings: TmgOrderIntakeSettings;
  canConfigure: boolean;
  canApprove: boolean;
}) {
  const [settings, setSettings] = useState(initialSettings);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [batches, setBatches] = useState<TmgBatch[]>([]);
  const [loadingBatches, setLoadingBatches] = useState(true);
  const [batchAction, setBatchAction] = useState<string | null>(null);

  const loadBatches = useCallback(async () => {
    setLoadingBatches(true);
    try {
      const response = await fetch("/api/operations/tmg-order-intake/batches", { cache: "no-store" });
      const json = await response.json() as { batches?: TmgBatch[]; error?: string };
      if (!response.ok || !json.batches) throw new Error(json.error ?? "Unable to load TMG batches.");
      setBatches(json.batches);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to load TMG batches.");
    } finally {
      setLoadingBatches(false);
    }
  }, []);

  useEffect(() => { void loadBatches(); }, [loadBatches]);

  async function scanMailbox() {
    setBatchAction("scan");
    setMessage(null);
    try {
      const response = await fetch("/api/operations/tmg-order-intake/batches", { method: "POST" });
      const json = await response.json() as { batches?: TmgBatch[]; error?: string };
      if (!response.ok || !json.batches) throw new Error(json.error ?? "Unable to scan the TMG mailbox.");
      setBatches(json.batches);
      setMessage("TMG mailbox scan completed.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to scan the TMG mailbox.");
    } finally {
      setBatchAction(null);
    }
  }

  async function approveBatch(batch: TmgBatch) {
    const readyCount = batch.readyOrderCount;
    if (!window.confirm(`Approve creation and document upload for ${readyCount} validated TMG order${readyCount === 1 ? "" : "s"}? Invalid orders will remain in review.`)) return;
    setBatchAction(batch.id);
    setMessage(null);
    try {
      const response = await fetch(`/api/operations/tmg-order-intake/batches/${encodeURIComponent(batch.id)}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmed: true })
      });
      const json = await response.json() as { error?: string };
      if (!response.ok) throw new Error(json.error ?? "Unable to approve the TMG batch.");
      await loadBatches();
      setMessage("TMG orders approved. The separate Teamship worker can now create and upload them.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to approve the TMG batch.");
    } finally {
      setBatchAction(null);
    }
  }

  async function saveSettings(formData: FormData) {
    setSaving(true);
    setMessage(null);
    const payload = {
      enabled: formData.get("enabled") === "on",
      mailboxAddress: String(formData.get("mailboxAddress") ?? ""),
      allowedSenderAddresses: splitLines(formData.get("allowedSenderAddresses")),
      subjectPrefix: String(formData.get("subjectPrefix") ?? ""),
      lookbackDays: Number(formData.get("lookbackDays")),
      maxMessagesPerScan: Number(formData.get("maxMessagesPerScan")),
      internalSummaryRecipients: splitLines(formData.get("internalSummaryRecipients")),
      teamship: {
        customerId: String(formData.get("customerId") ?? ""),
        customerName: String(formData.get("customerName") ?? ""),
        warehouseId: String(formData.get("warehouseId") ?? ""),
        warehouseName: String(formData.get("warehouseName") ?? ""),
        inventoryUserId: String(formData.get("inventoryUserId") ?? ""),
        inventoryLocationId: String(formData.get("inventoryLocationId") ?? ""),
        carrierName: String(formData.get("carrierName") ?? "")
      }
    };
    try {
      const response = await fetch("/api/operations/tmg-order-intake/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const json = await response.json() as { settings?: TmgOrderIntakeSettings; error?: string };
      if (!response.ok || !json.settings) throw new Error(json.error ?? "Unable to save TMG settings.");
      setSettings(json.settings);
      setMessage("TMG order-intake settings saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to save TMG settings.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Automation readiness</h2>
            <p className="mt-1 text-sm text-mutedForeground">
              TMG uses its own mailbox rules, Teamship customer scope, approval records, and upload worker queue.
            </p>
          </div>
          <span className={[
            "rounded-full px-3 py-1 text-xs font-semibold",
            settings.enabled && settings.configured
              ? "bg-emerald-100 text-emerald-800"
              : "bg-amber-100 text-amber-800"
          ].join(" ")}>
            {settings.enabled && settings.configured ? "Enabled" : "Setup required"}
          </span>
        </div>
        {settings.configurationIssues.length > 0 ? (
          <ul className="mt-4 space-y-1 text-sm text-amber-800">
            {settings.configurationIssues.map((issue) => <li key={issue}>- {issue}</li>)}
          </ul>
        ) : null}
      </section>

      <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Email batches</h2>
            <p className="mt-2 text-sm text-mutedForeground">
              Only fully validated rows are included in CSR approval. Delivery notes are excluded; warehouse instructions remain visible below and in the internal completion email.
            </p>
          </div>
          {canApprove ? (
            <button type="button" onClick={() => void scanMailbox()} disabled={batchAction !== null || !settings.configured} className="rounded-lg border border-border px-4 py-2 text-sm font-semibold disabled:opacity-50">
              {batchAction === "scan" ? "Scanning..." : "Scan mailbox now"}
            </button>
          ) : null}
        </div>
        {loadingBatches ? <p className="mt-5 text-sm text-mutedForeground">Loading TMG batches...</p> : null}
        {!loadingBatches && batches.length === 0 ? (
          <div className="mt-4 rounded-lg border border-dashed border-border p-6 text-center text-sm text-mutedForeground">No TMG batch has been loaded in this environment.</div>
        ) : null}
        <div className="mt-5 space-y-4">
          {batches.map((batch) => (
            <article key={batch.id} className="rounded-lg border border-border p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="font-semibold text-foreground">{batch.subject}</h3>
                  <p className="mt-1 text-xs text-mutedForeground">Received {new Date(batch.receivedAt).toLocaleString()} · {batch.fromAddress}</p>
                </div>
                <span className="rounded-full bg-muted px-3 py-1 text-xs font-semibold">{labelStatus(batch.status)}</span>
              </div>
              <div className="mt-3 grid gap-2 text-sm sm:grid-cols-4">
                <Metric label="Orders" value={batch.orderCount} />
                <Metric label="Ready" value={batch.readyOrderCount} />
                <Metric label="Needs review" value={batch.invalidOrderCount} />
                <Metric label="Summary" value={labelStatus(batch.summaryStatus)} />
              </div>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[760px] text-left text-sm">
                  <thead className="text-xs uppercase text-mutedForeground"><tr><th className="pb-2">Customer ref.</th><th className="pb-2">Ship to</th><th className="pb-2">Products</th><th className="pb-2">PRO</th><th className="pb-2">Warehouse notes</th><th className="pb-2">Status</th></tr></thead>
                  <tbody className="divide-y divide-border">
                    {batch.orders.map((order) => {
                      const packing = order.packingSlip;
                      return <tr key={order.id} className="align-top">
                        <td className="py-3 font-medium">{order.customerReference}</td>
                        <td className="py-3">{packing.shipTo.name}<br /><span className="text-mutedForeground">{packing.shipTo.city}, {packing.shipTo.state}</span></td>
                        <td className="py-3">{packing.items.map((item) => `${item.sku} × ${item.quantity}`).join(", ")}</td>
                        <td className="py-3">{order.bol?.proNumber ?? "—"}</td>
                        <td className="max-w-xs py-3">{order.warehouseInstructions ?? "—"}</td>
                        <td className="py-3">
                          <span>{labelStatus(order.status)}</span>
                          {order.validationIssues.length > 0 ? <ul className="mt-1 text-xs text-red-700">{order.validationIssues.map((issue) => <li key={`${issue.code}-${issue.message}`}>{issue.message}</li>)}</ul> : null}
                          {order.teamshipUrl ? <a className="mt-1 block text-primary underline" href={order.teamshipUrl} target="_blank" rel="noreferrer">Open Teamship {order.teamshipOrderNumber}</a> : null}
                          {order.errorMessage ? <span className="mt-1 block text-xs text-red-700">{order.errorMessage}</span> : null}
                        </td>
                      </tr>;
                    })}
                  </tbody>
                </table>
              </div>
              {canApprove && batch.executionJob?.status === "PENDING_APPROVAL" && batch.readyOrderCount > 0 ? (
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-muted p-3">
                  <p className="text-sm">Approve {batch.readyOrderCount} validated order{batch.readyOrderCount === 1 ? "" : "s"}. {batch.invalidOrderCount > 0 ? `${batch.invalidOrderCount} invalid order(s) remain blocked.` : ""}</p>
                  <button type="button" onClick={() => void approveBatch(batch)} disabled={batchAction !== null} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primaryForeground disabled:opacity-50">{batchAction === batch.id ? "Approving..." : "Approve TMG orders"}</button>
                </div>
              ) : null}
            </article>
          ))}
        </div>
      </section>

      {canConfigure ? (
        <details className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <summary className="cursor-pointer text-lg font-semibold text-foreground">TMG configuration</summary>
          <form action={saveSettings} className="mt-5 space-y-5">
            <label className="flex gap-3 rounded-lg border border-border p-4 text-sm">
              <input name="enabled" type="checkbox" defaultChecked={settings.enabled} />
              <span><strong className="block text-foreground">Enable scheduled TMG intake</strong>Keep this off until the mailbox and Teamship scope have been reviewed.</span>
            </label>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Mailbox address" name="mailboxAddress" defaultValue={settings.mailboxAddress ?? ""} />
              <Field label="Subject prefix" name="subjectPrefix" defaultValue={settings.subjectPrefix} />
              <TextArea label="Exact allowed sender addresses" name="allowedSenderAddresses" defaultValue={settings.allowedSenderAddresses.join("\n")} />
              <TextArea label="Internal summary recipients" name="internalSummaryRecipients" defaultValue={settings.internalSummaryRecipients.join("\n")} />
              <Field label="Lookback days" name="lookbackDays" type="number" defaultValue={String(settings.lookbackDays)} />
              <Field label="Maximum messages per scan" name="maxMessagesPerScan" type="number" defaultValue={String(settings.maxMessagesPerScan)} />
            </div>
            <h3 className="text-sm font-semibold uppercase tracking-wide text-mutedForeground">Teamship scope</h3>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Customer ID" name="customerId" defaultValue={settings.teamship?.customerId ?? ""} />
              <Field label="Customer name" name="customerName" defaultValue={settings.teamship?.customerName ?? ""} />
              <Field label="Warehouse ID" name="warehouseId" defaultValue={settings.teamship?.warehouseId ?? ""} />
              <Field label="Warehouse name" name="warehouseName" defaultValue={settings.teamship?.warehouseName ?? ""} />
              <Field label="Inventory user ID" name="inventoryUserId" defaultValue={settings.teamship?.inventoryUserId ?? ""} />
              <Field label="Inventory location ID" name="inventoryLocationId" defaultValue={settings.teamship?.inventoryLocationId ?? ""} />
              <Field label="Carrier name" name="carrierName" defaultValue={settings.teamship?.carrierName ?? ""} />
            </div>
            <div className="flex items-center gap-3">
              <button type="submit" disabled={saving} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primaryForeground disabled:opacity-50">
                {saving ? "Saving..." : "Save TMG configuration"}
              </button>
              {message ? <span className="text-sm text-mutedForeground">{message}</span> : null}
            </div>
          </form>
        </details>
      ) : null}
    </div>
  );
}

function Field({ label, name, defaultValue, type = "text" }: { label: string; name: string; defaultValue: string; type?: string }) {
  return (
    <label className="text-sm font-medium text-foreground">
      <span className="mb-1 block">{label}</span>
      <input name={name} type={type} defaultValue={defaultValue} className="w-full rounded-lg border border-border bg-background px-3 py-2" />
    </label>
  );
}

function TextArea({ label, name, defaultValue }: { label: string; name: string; defaultValue: string }) {
  return (
    <label className="text-sm font-medium text-foreground">
      <span className="mb-1 block">{label}</span>
      <textarea name={name} defaultValue={defaultValue} rows={4} className="w-full rounded-lg border border-border bg-background px-3 py-2" />
    </label>
  );
}

function splitLines(value: FormDataEntryValue | null) {
  return String(value ?? "").split(/[\n,;]/).map((entry) => entry.trim()).filter(Boolean);
}

type TmgBatch = {
  id: string;
  subject: string;
  fromAddress: string;
  receivedAt: string;
  status: string;
  orderCount: number;
  readyOrderCount: number;
  invalidOrderCount: number;
  summaryStatus: string;
  executionJob: { status: string } | null;
  orders: Array<{
    id: string;
    customerReference: string;
    status: string;
    packingSlip: { shipTo: { name: string; city: string; state: string }; items: Array<{ sku: string; quantity: number }> };
    bol: { proNumber?: string } | null;
    warehouseInstructions: string | null;
    validationIssues: Array<{ code: string; message: string }>;
    teamshipOrderNumber: string | null;
    teamshipUrl: string | null;
    errorMessage: string | null;
  }>;
};

function Metric({ label, value }: { label: string; value: string | number }) {
  return <div className="rounded-md bg-muted px-3 py-2"><span className="block text-xs text-mutedForeground">{label}</span><strong>{value}</strong></div>;
}

function labelStatus(value: string) {
  return value.toLowerCase().replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
}
