"use client";

import { useActionState } from "react";
import { updateSupplyChainDesignProjectCurrencySettingsAction } from "@/modules/supply-chain-design/actions";

type CurrencySettingsState = { ok: boolean; message: string };

export function SupplyChainDesignProjectCurrencySettingsForm({ projectId, analysisCurrency, cadToUsdRate }: {
  projectId: string;
  analysisCurrency: "USD" | "CAD";
  cadToUsdRate: number | null;
}) {
  const [state, action, pending] = useActionState(
    async (_previous: CurrencySettingsState, formData: FormData) =>
      updateSupplyChainDesignProjectCurrencySettingsAction(formData),
    { ok: false, message: "" }
  );
  return (
    <div className="mt-5 rounded-md border border-border bg-background p-4">
      <h3 className="text-sm font-semibold text-foreground">Project currency settings</h3>
      <p className="mt-1 text-sm text-mutedForeground">
        Save the preferred analysis currency and conversion rate. Existing saved results remain unchanged.
      </p>
      <form action={action} className="mt-3 grid gap-3 md:grid-cols-[220px_220px_auto] md:items-end">
        <input type="hidden" name="projectId" value={projectId} />
        <label className="space-y-1 text-sm">
          <span>Analysis Currency</span>
          <select name="analysisCurrency" defaultValue={analysisCurrency} className="w-full rounded-md border border-border bg-background px-3 py-2">
            <option value="USD">USD</option><option value="CAD">CAD</option>
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span>FX rate: 1 CAD = X USD</span>
          <input type="number" name="cadToUsdRate" defaultValue={cadToUsdRate ?? ""} min="0.000001" max="5" step="0.000001" className="w-full rounded-md border border-border bg-background px-3 py-2" />
        </label>
        <button type="submit" disabled={pending} className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primaryForeground disabled:opacity-50">
        {pending ? "Saving..." : "Save currency settings"}
        </button>
      </form>
      {state.message ? <p role={state.ok ? "status" : "alert"} className="mt-3 text-sm">{state.message}</p> : null}
    </div>
  );
}
