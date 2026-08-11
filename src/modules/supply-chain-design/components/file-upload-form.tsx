"use client";

import { useActionState, useRef, useState } from "react";
import { useFormStatus } from "react-dom";

import { uploadSupplyChainDesignProjectFilesAction } from "@/modules/supply-chain-design/actions";
import { SUPPLY_CHAIN_DESIGN_CSV_MAX_BYTES, formatBytes } from "@/modules/supply-chain-design/file-size";

const initialState = {
  ok: false,
  message: ""
};

export function SupplyChainDesignFileUploadForm({ projectId, existingFileNames = [] }: { projectId: string; existingFileNames?: string[] }) {
  const formRef = useRef<HTMLFormElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [duplicateFileNames, setDuplicateFileNames] = useState<string[]>([]);
  const [state, formAction] = useActionState(async (previousState: typeof initialState, formData: FormData) => {
    const result = await uploadSupplyChainDesignProjectFilesAction(previousState, formData);
    if (result.ok) {
      formRef.current?.reset();
      setDuplicateFileNames([]);
    }
    return result;
  }, initialState);
  const existingNames = new Set(existingFileNames.map((name) => name.toLowerCase()));

  return (
    <form
      ref={formRef}
      action={formAction}
      className="space-y-3"
      onSubmit={(event) => {
        const selectedNames = Array.from(fileInputRef.current?.files ?? []).map((file) => file.name);
        const duplicates = selectedNames.filter((name) => existingNames.has(name.toLowerCase()));
        if (duplicates.length > 0) {
          event.preventDefault();
          setDuplicateFileNames(duplicates);
        }
      }}
    >
      <input type="hidden" name="projectId" value={projectId} />
      <div className="rounded-md border border-border bg-background p-4">
        <label className="block space-y-2">
          <span className="text-sm font-medium text-foreground">CSV files</span>
          <input
            ref={fileInputRef}
            name="files"
            type="file"
            accept=".csv,text/csv"
            multiple
            onChange={() => {
              setDuplicateFileNames([]);
            }}
            className="block w-full text-sm text-foreground file:mr-4 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-2 file:text-sm file:font-semibold file:text-primaryForeground"
          />
        </label>
        <p className="mt-2 text-xs text-mutedForeground">
          Supported format: CSV. Maximum file size: {formatBytes(SUPPLY_CHAIN_DESIGN_CSV_MAX_BYTES)} per file.
        </p>
      </div>
      {duplicateFileNames.length > 0 ? (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950" role="dialog" aria-modal="false">
          <p className="font-semibold">A file with this name already exists.</p>
          <p className="mt-1">{duplicateFileNames.join(", ")}</p>
          <p className="mt-1">Rename the file before uploading so existing project evidence is preserved.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                setDuplicateFileNames([]);
              }}
              className="rounded-md border border-border px-3 py-2 text-sm font-semibold text-foreground"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
      <UploadButton />
      {state.message ? (
        <p className={state.ok ? "text-sm font-medium text-success" : "text-sm font-medium text-danger"}>
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

function UploadButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primaryForeground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? "Uploading..." : "Upload CSV"}
    </button>
  );
}
