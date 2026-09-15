import Link from "next/link";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/page-header";
import { SupplyChainDesignFileMappingForm } from "@/modules/supply-chain-design/components/file-mapping-form";
import { requireSupplyChainDesignStudioAccess } from "@/modules/supply-chain-design/access";
import { getSupplyChainDesignProjectFile } from "@/modules/supply-chain-design/queries";
import { getAuthenticatedContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

export default async function SupplyChainDesignProjectFilePage({
  params
}: {
  params: Promise<{ projectId: string; fileId: string }>;
}) {
  const context = await getAuthenticatedContext();
  await requireSupplyChainDesignStudioAccess(context);
  const { projectId, fileId } = await params;
  const file = await getSupplyChainDesignProjectFile(context, projectId, fileId);
  if (!file) notFound();

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Supply Chain Design Studio" title={file.originalFileName} description="Map this customer file to the approved Supply Chain Design data contract." />
      <Link href={`/supply-chain-design/${projectId}`} className="text-sm font-semibold text-primary hover:underline">Back to project</Link>
      <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <h2 className="text-base font-semibold text-foreground">Logical table mapping</h2>
        <SupplyChainDesignFileMappingForm
          projectId={projectId}
          fileId={file.id}
          detectedHeaders={file.detectedHeaders}
          mapping={file.mapping}
        />
      </section>
      <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <h2 className="text-base font-semibold text-foreground">CSV preview</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full divide-y divide-border text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-mutedForeground">
              <tr>{file.detectedHeaders.map((header) => <th key={header} className="px-3 py-2 font-semibold">{header}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-border">
              {file.previewRows.map((row, rowIndex) => (
                <tr key={`${row.join("|")}-${rowIndex}`}>{file.detectedHeaders.map((header, index) => <td key={`${header}-${index}`} className="px-3 py-2 text-mutedForeground">{row[index] ?? ""}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
