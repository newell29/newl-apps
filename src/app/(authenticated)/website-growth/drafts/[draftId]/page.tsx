import { ModuleKey, WebsiteGrowthContentDraftSource } from "@prisma/client";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { readWebsiteGrowthBuildPackage } from "@/modules/website-growth/build-package";
import { reviewWebsiteGrowthClaims } from "@/modules/website-growth/claims-policy";
import {
  findWebsiteGrowthBuildRequestForDraft,
  summarizeWebsiteGrowthBuildRequest
} from "@/modules/website-growth/build-requests";
import { retryWebsiteGrowthDeveloperBuildAction } from "@/modules/website-growth/actions";
import type {
  WebsiteGrowthPageChangePreview,
  WebsiteGrowthRenderedPagePreview
} from "@/modules/website-growth/content-drafts";
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
  const buildPackage = readWebsiteGrowthBuildPackage(draft.draftJson);
  const claimReview = reviewWebsiteGrowthClaims(draft.draftJson);
  const developerBuildJob = await findWebsiteGrowthBuildRequestForDraft(context.tenantId, draft.id);
  const developerBuild = developerBuildJob ? summarizeWebsiteGrowthBuildRequest(developerBuildJob) : null;

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

      <WebsiteStylePreview
        proposedPath={draft.proposedPath}
        payload={payload}
      />
      <ExistingPageChangePreview preview={payload.pageChangePreview} />

      <section className={claimReview.status === "CLEAR" ? "rounded-lg border border-success/25 bg-success/10 p-5" : claimReview.status === "BLOCKED" ? "rounded-lg border border-danger/25 bg-danger/10 p-5" : "rounded-lg border border-warning/25 bg-warning/10 p-5"}>
        <p className="text-xs font-semibold uppercase tracking-wide text-foreground">Claims and substantiation</p>
        <h2 className="mt-2 text-xl font-semibold text-foreground">
          {claimReview.status === "CLEAR" ? "No restricted claims detected." : claimReview.status === "BLOCKED" ? "Revise blocked claim language before approval." : "Owner confirmation is required before approval."}
        </h2>
        {claimReview.findings.length > 0 ? (
          <ul className="mt-4 space-y-3 text-sm leading-6 text-mutedForeground">
            {claimReview.findings.map((finding) => (
              <li key={`${finding.category}-${finding.excerpt}`}><strong className="text-foreground">{finding.category}:</strong> {finding.excerpt} — {finding.reason}</li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        {buildPackage ? (
          <div className="rounded-lg border border-success/25 bg-success/10 p-5 lg:col-span-2">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-success">Build package ready</p>
                <h2 className="mt-2 text-xl font-semibold text-foreground">Approval created a PR-ready implementation package.</h2>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-mutedForeground">
                  This is the handoff object the website executor can use to create a GitHub branch, build the Newl website route, open a PR, and wait for the Vercel preview before anything goes live.
                </p>
              </div>
              <Badge className="border-success/25 bg-background text-success">{formatStatusLike(buildPackage.mode)}</Badge>
            </div>
            <dl className="mt-5 grid gap-4 md:grid-cols-3">
              <SummaryRow label="Route" value={buildPackage.routePath} />
              <SummaryRow label="Branch" value={buildPackage.branchName} />
              <SummaryRow label="Target repo" value={buildPackage.targetRepo} />
              <SummaryRow label="Developer run" value={developerBuild ? `${formatStatusLike(developerBuild.phase)} · ${developerBuild.model} (${developerBuild.reasoningEffort})` : "Starts automatically after approval"} />
            </dl>
            <div className="mt-5 grid gap-4 lg:grid-cols-2">
              <ReviewPanel title="Build flow" items={buildPackage.approvalFlow} />
              <ReviewPanel title="Implementation file plan" items={buildPackage.implementation.filePlan} />
            </div>
            {draft.pullRequestUrl ? (
              <Link
                href={draft.pullRequestUrl}
                className="mt-5 inline-flex rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primaryForeground transition-colors hover:bg-primaryHover"
              >
                View GitHub PR
              </Link>
            ) : developerBuild?.canRetry ? (
              <form action={retryWebsiteGrowthDeveloperBuildAction} className="mt-5">
                <input type="hidden" name="draftId" value={draft.id} />
                <button className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primaryForeground transition-colors hover:bg-primaryHover">
                  Retry developer build
                </button>
                <p className="mt-2 max-w-2xl text-xs leading-5 text-mutedForeground">
                  Approval starts the Codex workflow automatically. Use this only after a configuration or dispatch failure; successful runs open a draft PR and store its link here.
                </p>
              </form>
            ) : (
              <p className="mt-5 text-sm leading-6 text-mutedForeground">
                {developerBuild ? `Developer run: ${formatStatusLike(developerBuild.phase)}.` : "The Codex developer run starts automatically after approval."}
              </p>
            )}
          </div>
        ) : null}
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

function ExistingPageChangePreview({ preview }: { preview: WebsiteGrowthPageChangePreview | null }) {
  if (!preview) {
    return (
      <section className="rounded-lg border border-warning/25 bg-warning/10 p-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-warning">Current page preview not available</p>
        <h2 className="mt-2 text-xl font-semibold text-foreground">Regenerate this draft to see exact page-change guidance.</h2>
        <p className="mt-2 text-sm leading-6 text-mutedForeground">
          Older drafts may only include proposal notes. New drafts include current page context, likely source files, and exact proposed changes before approval.
        </p>
      </section>
    );
  }

  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="border-b border-border bg-muted/30 p-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-primary">Current page and proposed changes</p>
        <h2 className="mt-2 text-2xl font-semibold text-foreground">Review what would actually change before approval.</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-mutedForeground">
          This is the implementation preview: it maps the SEO recommendation to the current page, existing Newl components, likely files, and the specific content changes the build step should make.
        </p>
      </div>
      <div className="grid gap-0 lg:grid-cols-[0.78fr_1.22fr]">
        <aside className="border-b border-border p-5 lg:border-b-0 lg:border-r">
          <p className="text-xs font-semibold uppercase tracking-wide text-mutedForeground">Current page</p>
          <dl className="mt-4 grid gap-4">
            <SummaryRow label="Path" value={preview.currentPage.path} />
            <SummaryRow label="Page type" value={preview.currentPage.pageType} />
            <SummaryRow label="Role" value={preview.currentPage.role} />
            <SummaryRow label="Focus" value={preview.currentPage.currentFocus} />
          </dl>
          <div className="mt-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-mutedForeground">Likely source files</p>
            <ul className="mt-3 space-y-2 text-sm leading-6 text-foreground">
              {preview.currentPage.likelySourceFiles.map((file) => (
                <li key={file} className="break-words rounded-md border border-border bg-background px-3 py-2">{file}</li>
              ))}
            </ul>
          </div>
          <div className="mt-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-mutedForeground">Existing component pattern</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {preview.currentPage.existingComponents.slice(0, 10).map((component) => (
                <span key={component} className="rounded-full border border-border bg-background px-2.5 py-1 text-xs font-semibold text-mutedForeground">
                  {component}
                </span>
              ))}
            </div>
          </div>
        </aside>
        <div className="p-5">
          <div className="grid gap-4">
            {preview.proposedChanges.map((change, index) => (
              <article key={`${change.changeType}-${change.location}-${index}`} className="rounded-md border border-border bg-background p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className="border-accentBorder bg-accentSoft text-primary">{formatStatusLike(change.changeType)}</Badge>
                  <p className="text-sm font-semibold text-foreground">{change.location}</p>
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <ChangeBox label="Current state" value={change.currentState} />
                  <ChangeBox label="Proposed state" value={change.proposedState} highlight />
                </div>
                {change.exactDraftCopy ? (
                  <div className="mt-3 rounded-md border border-primary/20 bg-primary/5 p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-primary">Draft copy to place on page</p>
                    <p className="mt-2 text-sm leading-6 text-foreground">{change.exactDraftCopy}</p>
                  </div>
                ) : null}
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <ChangeBox label="Why" value={change.reason} />
                  <ChangeBox label="Expected impact" value={change.impact} />
                </div>
              </article>
            ))}
          </div>
          <div className="mt-5 rounded-md border border-success/25 bg-success/10 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-success">Approval summary</p>
            <p className="mt-2 text-sm leading-6 text-foreground">{preview.approvalSummary}</p>
          </div>
          {preview.visualReviewNotes.length > 0 ? (
            <ReviewPanel title="Visual review notes" items={preview.visualReviewNotes} />
          ) : null}
        </div>
      </div>
    </section>
  );
}

function ChangeBox({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={highlight ? "rounded-md border border-primary/25 bg-primary/5 p-3" : "rounded-md border border-border bg-muted/20 p-3"}>
      <p className="text-xs font-semibold uppercase tracking-wide text-mutedForeground">{label}</p>
      <p className="mt-2 text-sm leading-6 text-foreground">{value || "Not specified"}</p>
    </div>
  );
}

function WebsiteStylePreview({
  proposedPath,
  payload
}: {
  proposedPath: string | null;
  payload: ReturnType<typeof readDraftPayload>;
}) {
  const preview = payload.pagePreview;

  if (!preview) {
    return (
      <section className="rounded-lg border border-warning/25 bg-warning/10 p-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-warning">Rendered page preview not available</p>
        <h2 className="mt-2 text-xl font-semibold text-foreground">Regenerate this draft after the latest deploy.</h2>
        <p className="mt-2 text-sm leading-6 text-mutedForeground">
          New drafts include a visitor-facing Newl page preview generated from the opportunity, website patterns, and review context.
        </p>
      </section>
    );
  }

  const pathLabel = proposedPath || "Draft URL not assigned";

  return (
    <section className="overflow-hidden rounded-lg border border-border bg-white shadow-sm">
      <div className="flex flex-col gap-2 border-b border-border bg-muted/40 px-5 py-3 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-primary">Generated Newl page preview</p>
          <p className="mt-1 text-sm text-mutedForeground">
            This is the visitor-facing page experience generated for review before any Git or Vercel publishing work.
          </p>
        </div>
        <span className="rounded-full border border-border bg-white px-3 py-1 text-xs font-semibold text-mutedForeground">
          {pathLabel}
        </span>
      </div>

      <div className="bg-[#172235] text-white">
        <div className="mx-auto grid max-w-7xl gap-10 px-5 py-16 lg:grid-cols-[minmax(0,1fr)_minmax(360px,0.78fr)] lg:items-center">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.22em] text-[#ffb5c7]">
              {preview.eyebrow || "WAREHOUSE-LED LOGISTICS"}
            </p>
            <h1 className="mt-5 max-w-4xl text-4xl font-bold leading-tight tracking-tight md:text-6xl">
              {preview.heroTitle}
            </h1>
            <p className="mt-6 max-w-3xl text-lg leading-8 text-[#cbd7e8]">{preview.heroCopy}</p>
            {preview.heroBullets.length > 0 ? (
              <div className="mt-7 flex flex-wrap gap-3">
                {preview.heroBullets.slice(0, 4).map((bullet) => (
                  <span key={bullet} className="rounded-md border border-white/15 bg-white/8 px-4 py-3 text-sm font-semibold text-white">
                    {bullet}
                  </span>
                ))}
              </div>
            ) : null}
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <span className="inline-flex min-h-11 items-center justify-center rounded-md bg-primary px-5 py-3 text-sm font-bold text-white shadow-sm">
                {preview.primaryCta || "Request Logistics Review"}
              </span>
              <span className="inline-flex min-h-11 items-center justify-center rounded-md border border-white/25 px-5 py-3 text-sm font-bold text-white">
                {preview.secondaryCta || "Talk to Newl"}
              </span>
            </div>
          </div>

          <div className="rounded-lg border border-white/15 bg-[#20314c] p-5 shadow-2xl shadow-black/20">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#ffb5c7]">Operating model</p>
            <div className="mt-5 grid gap-3">
              {preview.proofCards.slice(0, 4).map((card) => (
                <article key={`${card.label}-${card.value}`} className="rounded-md border border-white/10 bg-white/8 p-4">
                  <p className="text-xs font-bold uppercase tracking-wide text-[#ffb5c7]">{card.label}</p>
                  <h3 className="mt-2 text-xl font-bold text-white">{card.value}</h3>
                  <p className="mt-2 text-sm leading-6 text-[#cbd7e8]">{card.body}</p>
                </article>
              ))}
            </div>
          </div>
        </div>
      </div>

      {preview.sections.map((section, index) => (
        <section
          key={`${section.heading}-${index}`}
          className={index % 2 === 0 ? "border-b border-border bg-[#f6f8fc] px-5 py-16" : "border-b border-border bg-white px-5 py-16"}
        >
          <div className="mx-auto grid max-w-7xl gap-8 lg:grid-cols-[0.85fr_1fr] lg:items-start">
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-primary">{section.eyebrow || "NEWL CAPABILITY"}</p>
              <h2 className="mt-3 text-3xl font-bold tracking-tight text-foreground md:text-4xl">{section.heading}</h2>
              <p className="mt-4 text-base leading-7 text-mutedForeground">{section.body}</p>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              {section.cards.map((card) => (
                <article
                  key={`${section.heading}-${card.title}`}
                  className="rounded-md border border-border bg-white p-5 shadow-sm transition-colors hover:border-primary hover:bg-accentSoft"
                >
                  <h3 className="text-xl font-bold text-foreground">{card.title}</h3>
                  <p className="mt-3 text-sm leading-6 text-mutedForeground">{card.body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>
      ))}

      {preview.internalLinks.length > 0 || preview.faqs.length > 0 ? (
        <section className="border-b border-border bg-[#f6f8fc] px-5 py-16">
          <div className="mx-auto grid max-w-7xl gap-8 lg:grid-cols-2">
            {preview.internalLinks.length > 0 ? (
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-primary">Related Newl pages</p>
                <h2 className="mt-3 text-3xl font-bold tracking-tight text-foreground">Where visitors can go next.</h2>
                <div className="mt-6 grid gap-3">
                  {preview.internalLinks.slice(0, 5).map((link) => (
                    <article key={`${link.label}-${link.url}`} className="rounded-md border border-border bg-white p-5 shadow-sm">
                      <p className="font-bold text-foreground">{link.label}</p>
                      <p className="mt-1 break-words text-sm font-semibold text-primary">{link.url}</p>
                      <p className="mt-2 text-sm leading-6 text-mutedForeground">{link.reason}</p>
                    </article>
                  ))}
                </div>
              </div>
            ) : null}
            {preview.faqs.length > 0 ? (
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-primary">FAQ</p>
                <h2 className="mt-3 text-3xl font-bold tracking-tight text-foreground">Questions this page answers.</h2>
                <div className="mt-6 grid gap-3">
                  {preview.faqs.map((faq) => (
                    <article key={faq.question} className="rounded-md border border-border bg-white p-5 shadow-sm">
                      <h3 className="font-bold text-foreground">{faq.question}</h3>
                      <p className="mt-2 text-sm leading-6 text-mutedForeground">{faq.answer}</p>
                    </article>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      <section className="bg-[#172235] px-5 py-12 text-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-5 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#ffb5c7]">Work with Newl</p>
            <h2 className="mt-3 text-3xl font-bold">{preview.finalCta.heading || "Build the right logistics plan."}</h2>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-[#cbd7e8]">{preview.finalCta.body}</p>
          </div>
          <span className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-md bg-primary px-5 py-3 text-sm font-bold text-white">
            {preview.finalCta.buttonLabel || "Request Assessment"}
          </span>
        </div>
      </section>
    </section>
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
    designSystemNotes: readStringArray(record.designSystemNotes),
    pageChangePreview: readPageChangePreview(record.pageChangePreview),
    pagePreview: readRenderedPagePreview(record.pagePreview)
  };
}

function readRenderedPagePreview(value: unknown): WebsiteGrowthRenderedPagePreview | null {
  const record = isRecord(value) ? value : null;

  if (!record) {
    return null;
  }

  const finalCta = isRecord(record.finalCta) ? record.finalCta : {};

  return {
    mode: readPreviewMode(record.mode),
    eyebrow: readString(record.eyebrow),
    heroTitle: readString(record.heroTitle),
    heroCopy: readString(record.heroCopy),
    heroBullets: readStringArray(record.heroBullets),
    primaryCta: readString(record.primaryCta),
    secondaryCta: readString(record.secondaryCta),
    proofCards: readObjectArray(record.proofCards)
      .map((card) => ({
        label: readString(card.label),
        value: readString(card.value),
        body: readString(card.body)
      }))
      .filter((card) => card.label && card.value),
    sections: readObjectArray(record.sections)
      .map((section) => ({
        eyebrow: readString(section.eyebrow),
        heading: readString(section.heading),
        body: readString(section.body),
        cards: readObjectArray(section.cards)
          .map((card) => ({
            title: readString(card.title),
            body: readString(card.body)
          }))
          .filter((card) => card.title && card.body)
      }))
      .filter((section) => section.heading && section.body),
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
    finalCta: {
      heading: readString(finalCta.heading),
      body: readString(finalCta.body),
      buttonLabel: readString(finalCta.buttonLabel)
    }
  };
}

function readPreviewMode(value: unknown): WebsiteGrowthRenderedPagePreview["mode"] {
  const allowed: WebsiteGrowthRenderedPagePreview["mode"][] = [
    "new_page",
    "existing_page_update",
    "legacy_redirect_rebuild",
    "internal_link_update"
  ];

  return typeof value === "string" && allowed.includes(value as WebsiteGrowthRenderedPagePreview["mode"])
    ? (value as WebsiteGrowthRenderedPagePreview["mode"])
    : "new_page";
}

function readPageChangePreview(value: unknown): WebsiteGrowthPageChangePreview | null {
  const record = isRecord(value) ? value : null;

  if (!record) {
    return null;
  }

  const currentPage = isRecord(record.currentPage) ? record.currentPage : {};
  const proposedChanges = readObjectArray(record.proposedChanges)
    .map((change) => ({
      changeType: readChangeType(change.changeType),
      location: readString(change.location),
      currentState: readString(change.currentState),
      proposedState: readString(change.proposedState),
      exactDraftCopy: readString(change.exactDraftCopy) || undefined,
      reason: readString(change.reason),
      impact: readString(change.impact)
    }))
    .filter((change) => change.location && change.proposedState);

  return {
    currentPage: {
      path: readString(currentPage.path) || "/",
      pageType: readString(currentPage.pageType) || "Newl website page",
      role: readString(currentPage.role),
      likelySourceFiles: readStringArray(currentPage.likelySourceFiles),
      existingComponents: readStringArray(currentPage.existingComponents),
      currentFocus: readString(currentPage.currentFocus)
    },
    proposedChanges,
    visualReviewNotes: readStringArray(record.visualReviewNotes),
    approvalSummary: readString(record.approvalSummary)
  };
}

function readChangeType(value: unknown): WebsiteGrowthPageChangePreview["proposedChanges"][number]["changeType"] {
  const allowed = ["meta", "hero", "section", "faq", "internal_links", "cta", "redirect", "technical"];

  return typeof value === "string" && allowed.includes(value)
    ? (value as WebsiteGrowthPageChangePreview["proposedChanges"][number]["changeType"])
    : "section";
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
