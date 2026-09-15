import Link from "next/link";
import React from "react";

import { PageHeader } from "@/components/page-header";
import { DeleteConfirmationCancelButton } from "@/modules/supply-chain-design/components/delete-confirmation-cancel-button";
import {
  createSupplyChainDesignProjectAction,
  deleteSupplyChainDesignProjectFormAction,
  listSupplyChainDesignProjects,
  requireSupplyChainDesignStudioAccess
} from "@/modules/supply-chain-design";
import { getAuthenticatedContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

export default async function SupplyChainDesignStudioPage() {
  const context = await getAuthenticatedContext();
  await requireSupplyChainDesignStudioAccess(context);
  const projects = await listSupplyChainDesignProjects(context);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Supply Chain Design Studio"
        title="Design projects"
        description="Create and manage Supply Chain Design projects using shared operational data, network analysis and candidate-location comparisons."
      />

      <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <h2 className="text-base font-semibold text-foreground">Create project</h2>
        <form action={createSupplyChainDesignProjectAction} className="mt-4 grid gap-4 md:grid-cols-[1fr_1.5fr_auto]">
          <label className="space-y-1">
            <span className="text-sm font-medium text-foreground">Project name</span>
            <input
              name="name"
              required
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
              placeholder="Example: 2026 network baseline"
            />
          </label>
          <label className="space-y-1">
            <span className="text-sm font-medium text-foreground">Description</span>
            <input
              name="description"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
              placeholder="Optional"
            />
          </label>
          <button
            type="submit"
            className="self-end rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primaryForeground transition-colors hover:bg-primary/90"
          >
            Create
          </button>
        </form>
      </section>

      <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-foreground">Projects</h2>
          <span className="text-sm text-mutedForeground">{projects.length} saved</span>
        </div>

        {projects.length === 0 ? (
          <p className="mt-4 rounded-md border border-dashed border-border bg-background p-6 text-sm text-mutedForeground">
            No Supply Chain Design Studio projects have been created yet.
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full divide-y divide-border text-sm">
              <thead className="bg-muted/50 text-left text-xs font-semibold uppercase tracking-wide text-mutedForeground">
                <tr>
                  <th className="px-3 py-3">Project</th>
                  <th className="px-3 py-3">Created</th>
                  <th className="px-3 py-3">Updated</th>
                  <th className="px-3 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {projects.map((project) => (
                  <tr key={project.id} className="align-top hover:bg-muted/30">
                    <td className="px-3 py-3">
                      <Link
                        href={`/supply-chain-design/${project.id}`}
                        className="font-semibold text-primary hover:underline"
                      >
                        {project.name}
                      </Link>
                      {project.description ? (
                        <div className="mt-1 text-xs text-mutedForeground">{project.description}</div>
                      ) : null}
                    </td>
                    <td className="px-3 py-3 text-mutedForeground">{formatDate(project.createdAt)}</td>
                    <td className="px-3 py-3 text-mutedForeground">{formatDate(project.updatedAt)}</td>
                    <td className="px-3 py-3">
                      <details>
                        <summary className="cursor-pointer text-xs font-semibold text-danger">Delete</summary>
                        <div className="mt-2 rounded-md border border-border bg-background p-3">
                          <p className="text-xs text-mutedForeground">
                            Deleting this project will permanently remove its uploaded files, mappings, saved runs and results.
                          </p>
                          <form action={deleteSupplyChainDesignProjectFormAction} className="mt-2 flex items-center gap-2">
                            <input type="hidden" name="projectId" value={project.id} />
                            <DeleteConfirmationCancelButton />
                            <button type="submit" name="confirmDelete" value="on" className="rounded-md bg-danger px-2 py-1 font-semibold text-dangerForeground">
                              Confirm delete
                            </button>
                          </form>
                        </div>
                      </details>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeZone: "America/Toronto"
  }).format(date);
}
