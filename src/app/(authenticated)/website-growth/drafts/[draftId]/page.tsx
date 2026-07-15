import { ModuleKey, WebsiteGrowthContentDraftSource } from "@prisma/client";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { requireModule } from "@/server/auth/authorization";
import { prisma } from "@/server/db";
import { getAuthenticatedContext } from "@/server/tenant-context";

type PageProps = {
  params: Promise<{
    draftId: string;
  }>;
};

export default async function WebsiteGrowthDraftPreviewPage({ params }: PageProps) {
  const { draftId } = await params;
  const context = await getAuthenticatedContext();
  await requireModule(context, ModuleKey.WEBSITE_GROWTH);

  const draft = await prisma.websiteGrowthContentDraft.findFirst({
    where: {
      id: draftId,
      tenantId: context.tenantId
    },
    include: {
      opportunity: true
    }
  });

  if (!draft) {
    notFound();
  }

  const payload = readDraftPayload(draft.draftJson);

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 border-b border-border pb-5 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-primary">Website Growth Draft</p>
          <h1 className="mt-2 text-3xl font-semibold text-foreground">{draft.title}</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-mutedForeground">
            Review the proposed content experience before approving it for build or publishing work.
          </p>
        </div>
        <div className="flex shrink-0">
          <Link
            href="/website-growth"
            className="rounded-md border border-border px-3 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted"
          >
            Back to queue
          </Link>
        </div>
      </header>

      <section className="rounded-lg border border-border bg-card p-5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge className="border-border bg-muted text-mutedForeground">{formatStatusLike(draft.status)}</Badge>
          <Badge className={draft.source === WebsiteGrowthContentDraftSource.AI ? "border-success/25 bg-success/10 text-success" : "border-warning/25 bg-warning/10 text-warning"}>
            {draft.source === WebsiteGrowthContentDraftSource.AI ? "AI prepared" : "Template prepared"}
          </Badge>
          <Badge className="border-accentBorder bg-accentSoft text-primary">{draft.contentType}</Badge>
        </div>
        <dl className="mt-5 grid gap-4 md:grid-cols-2">
          <SummaryRow label="Proposed path" value={draft.proposedPath} />
          <SummaryRow label="Target page" value={draft.targetPage} />
          <SummaryRow label="Target keyword" value={payload.targetKeyword} />
          <SummaryRow label="Search intent" value={payload.searchIntent} />
          <SummaryRow label="Newl page pattern" value={payload.websitePageType} />
          <SummaryRow label="Website template" value={payload.websiteTemplate} />
          <SummaryRow label="Opportunity" value={draft.opportunity.topic} />
          <SummaryRow label="Recommendation" value={draft.opportunity.recommendation} />
        </dl>
      </section>

      <section className="overflow-hidden rounded-lg border border-border bg-white">
        <div className="border-b border-border bg-muted/40 px-5 py-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-primary">Draft page preview</p>
          <p className="mt-1 text-sm text-mutedForeground">
            This is a private preview in Newl Apps. It is not live, indexed, or posted to Git.
          </p>
        </div>
        <article className="mx-auto max-w-5xl px-5 py-10">
          <p className="text-sm font-bold uppercase tracking-wide text-primary">{draft.contentType}</p>
          <h1 className="mt-3 max-w-4xl text-4xl font-bold tracking-tight text-foreground md:text-5xl">
            {draft.title}
          </h1>
          <p className="mt-5 max-w-3xl text-lg leading-8 text-mutedForeground">{draft.summary}</p>

          <div className="mt-8 rounded-md border border-border bg-muted/30 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-mutedForeground">SEO metadata</p>
            <dl className="mt-3 grid gap-3">
              <SummaryRow label="Meta title" value={payload.metaTitle} />
              <SummaryRow label="Meta description" value={payload.metaDescription} />
            </dl>
          </div>

          <div className="mt-10 space-y-8">
            {payload.sections.map((section) => (
              <section key={section.heading}>
                <p className="text-xs font-semibold uppercase tracking-wide text-primary">{section.purpose}</p>
                <h2 className="mt-2 text-2xl font-bold text-foreground">{section.heading}</h2>
                <p className="mt-3 text-base leading-7 text-mutedForeground">{section.draftCopy}</p>
              </section>
            ))}
          </div>

          {payload.faqs.length > 0 ? (
            <section className="mt-12 border-t border-border pt-8">
              <p className="text-xs font-semibold uppercase tracking-wide text-primary">FAQ</p>
              <h2 className="mt-2 text-2xl font-bold text-foreground">Questions this page should answer</h2>
              <div className="mt-5 grid gap-3">
                {payload.faqs.map((faq) => (
                  <div key={faq.question} className="rounded-md border border-border p-4">
                    <h3 className="font-semibold text-foreground">{faq.question}</h3>
                    <p className="mt-2 text-sm leading-6 text-mutedForeground">{faq.answer}</p>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
        </article>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <ReviewPanel title="Newl website layout" items={payload.layoutComponents} />
        <ReviewPanel title="Design system notes" items={payload.designSystemNotes} />
        <ReviewPanel title="Internal links" items={payload.internalLinks.map((link) => `${link.label} -> ${link.url}: ${link.reason}`)} />
        <ReviewPanel title="Build checklist" items={payload.reviewChecklist} />
        <ReviewPanel title="Implementation notes" items={payload.implementationNotes} />
        <ReviewPanel title="Supporting keywords" items={readStringArray(draft.opportunity.supportingKeywords)} />
      </section>
    </div>
  );
}

function Badge({ children, className }: { children: ReactNode; className: string }) {
  return (
    <span className={`inline-flex whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-semibold ${className}`}>
      {children}
    </span>
  );
}

function SummaryRow({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-mutedForeground">{label}</dt>
      <dd className="mt-1 break-words text-sm font-semibold text-foreground">{value || "Not provided"}</dd>
    </div>
  );
}

function ReviewPanel({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <h2 className="text-base font-semibold text-foreground">{title}</h2>
      {items.length === 0 ? (
        <p className="mt-3 text-sm text-mutedForeground">No items provided.</p>
      ) : (
        <ul className="mt-4 space-y-2 text-sm leading-6 text-mutedForeground">
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function readDraftPayload(value: unknown) {
  const record = isRecord(value) ? value : {};

  return {
    targetKeyword: readString(record.targetKeyword),
    searchIntent: readString(record.searchIntent),
    metaTitle: readString(record.metaTitle),
    metaDescription: readString(record.metaDescription),
    sections: readObjectArray(record.sections)
      .map((section) => ({
        heading: readString(section.heading),
        purpose: readString(section.purpose),
        draftCopy: readString(section.draftCopy)
      }))
      .filter((section) => section.heading && section.draftCopy),
    faqs: readObjectArray(record.faqs)
      .map((faq) => ({
        question: readString(faq.question),
        answer: readString(faq.answer)
      }))
      .filter((faq) => faq.question && faq.answer),
    internalLinks: readObjectArray(record.internalLinks)
      .map((link) => ({
        label: readString(link.label),
        url: readString(link.url),
        reason: readString(link.reason)
      }))
      .filter((link) => link.label && link.url),
    implementationNotes: readStringArray(record.implementationNotes),
    reviewChecklist: readStringArray(record.reviewChecklist),
    websitePageType: readString(record.websitePageType),
    websiteTemplate: readString(record.websiteTemplate),
    layoutComponents: readStringArray(record.layoutComponents),
    designSystemNotes: readStringArray(record.designSystemNotes)
  };
}

function readObjectArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => isRecord(item)) : [];
}

function readStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function formatStatusLike(value: string) {
  return value
    .toLowerCase()
    .replaceAll("_", " ")
    .split(" ")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
