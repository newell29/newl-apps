import { WebsiteGrowthAction, type Prisma } from "@prisma/client";

import type {
  WebsiteGrowthPageChangePreview,
  WebsiteGrowthRenderedPagePreview
} from "@/modules/website-growth/content-drafts";

export type WebsiteGrowthBuildPackage = {
  version: 1;
  status: "READY_FOR_PR";
  mode: "CREATE_NEW_PAGE" | "UPDATE_EXISTING_PAGE" | "ADD_TO_EXISTING_PAGE" | "ADD_INTERNAL_LINKS";
  routePath: string;
  targetRepo: string;
  branchName: string;
  sourceDraftId: string;
  sourceOpportunityId: string;
  title: string;
  contentType: string;
  metadata: {
    metaTitle: string;
    metaDescription: string;
    targetKeyword: string;
    searchIntent: string;
  };
  newlWebsitePattern: {
    pageType: string;
    sourceTemplate: string;
    layoutComponents: string[];
    designSystemNotes: string[];
  };
  implementation: {
    routeAction: string;
    filePlan: string[];
    pageChangePreview: WebsiteGrowthPageChangePreview | null;
    pagePreview: WebsiteGrowthRenderedPagePreview | null;
    sections: Array<{
      heading: string;
      purpose: string;
      draftCopy: string;
    }>;
    faqs: Array<{
      question: string;
      answer: string;
    }>;
    internalLinks: Array<{
      label: string;
      url: string;
      reason: string;
    }>;
    checklist: string[];
  };
  approvalFlow: string[];
  createdAt: string;
};

type DraftForBuildPackage = {
  id: string;
  opportunityId: string;
  title: string;
  contentType: string;
  proposedPath: string | null;
  targetPage: string | null;
  draftJson: Prisma.JsonValue;
  opportunity: {
    action: WebsiteGrowthAction;
    topic: string;
    targetPage: string | null;
    sourcePage: string | null;
  };
};

export function buildWebsiteGrowthBuildPackage(draft: DraftForBuildPackage): WebsiteGrowthBuildPackage {
  const payload = readDraftPayload(draft.draftJson);
  const routePath = resolveRoutePath(draft.proposedPath ?? draft.targetPage ?? draft.opportunity.targetPage, draft.opportunity.topic);
  const mode = resolveBuildMode(draft.opportunity.action, payload.pagePreview?.mode, draft.contentType);
  const branchName = `website-growth/${slugify(routePath) || slugify(draft.opportunity.topic) || draft.id.slice(-8)}`;

  return {
    version: 1,
    status: "READY_FOR_PR",
    mode,
    routePath,
    targetRepo: readEnv("NEWL_WEBSITE_GITHUB_REPO") || "Newl website repository",
    branchName,
    sourceDraftId: draft.id,
    sourceOpportunityId: draft.opportunityId,
    title: draft.title,
    contentType: draft.contentType,
    metadata: {
      metaTitle: payload.metaTitle || draft.title,
      metaDescription: payload.metaDescription || draft.title,
      targetKeyword: payload.targetKeyword || draft.opportunity.topic,
      searchIntent: payload.searchIntent || "Commercial research"
    },
    newlWebsitePattern: {
      pageType: payload.websitePageType || "Newl website page",
      sourceTemplate: payload.websiteTemplate || "Repo pattern scan",
      layoutComponents: payload.layoutComponents,
      designSystemNotes: payload.designSystemNotes
    },
    implementation: {
      routeAction: buildRouteAction(mode, routePath),
      filePlan: buildFilePlan(mode, routePath, payload.pageChangePreview, payload.pagePreview),
      pageChangePreview: payload.pageChangePreview,
      pagePreview: payload.pagePreview,
      sections: payload.sections,
      faqs: payload.faqs,
      internalLinks: payload.internalLinks,
      checklist: [
        ...payload.reviewChecklist,
        "Build the page or update using the same Newl website components, spacing, CTAs, FAQ pattern, and contact section behavior.",
        "Run the Newl website build before opening the PR.",
        "Use the Vercel preview URL for final visual approval before merging.",
        "After merge, confirm sitemap coverage and request indexing for new or rebuilt URLs."
      ]
    },
    approvalFlow: [
      "Newl Apps approval creates this implementation package.",
      "The GitHub execution step creates a website branch from main.",
      "The website change is committed to that branch using Newl website route/component patterns.",
      "A GitHub pull request is opened for review.",
      "Vercel creates a preview deployment from the pull request.",
      "After visual approval, the pull request is merged and the sitemap/Search Console follow-up is completed."
    ],
    createdAt: new Date().toISOString()
  };
}

export function mergeBuildPackageIntoDraftJson(
  draftJson: Prisma.JsonValue,
  buildPackage: WebsiteGrowthBuildPackage
): Prisma.InputJsonValue {
  const record = isRecord(draftJson) ? draftJson : {};

  return {
    ...record,
    buildPackage
  } as Prisma.InputJsonValue;
}

export function readWebsiteGrowthBuildPackage(value: unknown): WebsiteGrowthBuildPackage | null {
  const record = isRecord(value) ? value : {};
  const buildPackage = record.buildPackage;

  if (!isRecord(buildPackage) || buildPackage.version !== 1 || buildPackage.status !== "READY_FOR_PR") {
    return null;
  }

  return buildPackage as WebsiteGrowthBuildPackage;
}

function resolveBuildMode(
  action: WebsiteGrowthAction,
  pageMode?: WebsiteGrowthRenderedPagePreview["mode"] | null,
  contentType = ""
): WebsiteGrowthBuildPackage["mode"] {
  if (pageMode === "new_page" || pageMode === "legacy_redirect_rebuild") {
    return "CREATE_NEW_PAGE";
  }

  if (pageMode === "existing_page_update") {
    return "UPDATE_EXISTING_PAGE";
  }

  if (pageMode === "internal_link_update") {
    return "ADD_INTERNAL_LINKS";
  }

  if (/legacy|dedicated page|new commercial page|resource article/i.test(contentType)) {
    return "CREATE_NEW_PAGE";
  }

  switch (action) {
    case WebsiteGrowthAction.IMPROVE_EXISTING_PAGE:
      return "UPDATE_EXISTING_PAGE";
    case WebsiteGrowthAction.ADD_SECTION:
      return "ADD_TO_EXISTING_PAGE";
    case WebsiteGrowthAction.ADD_INTERNAL_LINKS:
      return "ADD_INTERNAL_LINKS";
    default:
      return "CREATE_NEW_PAGE";
  }
}

function buildRouteAction(mode: WebsiteGrowthBuildPackage["mode"], routePath: string) {
  if (mode === "UPDATE_EXISTING_PAGE") {
    return `Update the existing page at ${routePath}.`;
  }

  if (mode === "ADD_TO_EXISTING_PAGE") {
    return `Add the approved section to ${routePath}.`;
  }

  if (mode === "ADD_INTERNAL_LINKS") {
    return `Add internal links around ${routePath}.`;
  }

  return `Create or rebuild the page at ${routePath}.`;
}

function buildFilePlan(
  mode: WebsiteGrowthBuildPackage["mode"],
  routePath: string,
  pageChangePreview: WebsiteGrowthPageChangePreview | null,
  pagePreview: WebsiteGrowthRenderedPagePreview | null
) {
  const routeFile = `Newl website route for ${routePath}`;
  const sourceFileNotes = pageChangePreview?.currentPage.likelySourceFiles.map((file) => `Review likely source file: ${file}`) ?? [];
  const changeNotes =
    pageChangePreview?.proposedChanges.slice(0, 6).map((change) => `Apply ${change.changeType} change at ${change.location}: ${change.proposedState}`) ?? [];
  const renderedPreviewNotes = pagePreview
    ? [
        `Build the approved rendered page preview with hero "${pagePreview.heroTitle}".`,
        `Use the visitor-facing pagePreview content: ${pagePreview.sections.length} sections, ${pagePreview.faqs.length} FAQs, and final CTA "${pagePreview.finalCta.buttonLabel}".`
      ]
    : [];

  if (mode === "ADD_INTERNAL_LINKS") {
    return [
      ...sourceFileNotes,
      "Review the source and target website routes identified in the draft.",
      "Add contextual links using existing Newl link/button/card components.",
      "Verify the linked routes resolve and make sense for the reader.",
      ...renderedPreviewNotes,
      ...changeNotes
    ];
  }

  if (mode === "ADD_TO_EXISTING_PAGE" || mode === "UPDATE_EXISTING_PAGE") {
    return [
      ...sourceFileNotes,
      routeFile,
      "Existing metadata and sitemap route config if the title/description changes.",
      "Related navigation or internal-link components if the page needs stronger discovery.",
      ...renderedPreviewNotes,
      ...changeNotes
    ];
  }

  return [
    ...sourceFileNotes,
    routeFile,
    "Metadata entry for title, description, canonical URL, and sitemap inclusion.",
    "Internal links from relevant service, resource, location, or industry pages.",
    "FAQ schema or FAQ component when the draft includes questions.",
    ...renderedPreviewNotes,
    ...changeNotes
  ];
}

function resolveRoutePath(value: string | null | undefined, fallback: string) {
  const normalized = normalizePath(value);

  if (normalized) {
    return normalized;
  }

  return `/resources/${slugify(fallback) || "website-growth-draft"}`;
}

function normalizePath(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  try {
    const parsed = new URL(value);
    return parsed.pathname.replace(/\/+$/g, "") || "/";
  } catch {
    const trimmed = value.trim();

    if (!trimmed) {
      return null;
    }

    return `/${trimmed.replace(/^\/+/, "").replace(/\/+$/g, "")}`;
  }
}

function readDraftPayload(value: unknown) {
  const record = isRecord(value) ? value : {};

  return {
    metaTitle: readString(record.metaTitle),
    metaDescription: readString(record.metaDescription),
    targetKeyword: readString(record.targetKeyword),
    searchIntent: readString(record.searchIntent),
    websitePageType: readString(record.websitePageType),
    websiteTemplate: readString(record.websiteTemplate),
    layoutComponents: readStringArray(record.layoutComponents),
    designSystemNotes: readStringArray(record.designSystemNotes),
    reviewChecklist: readStringArray(record.reviewChecklist),
    pageChangePreview: readPageChangePreview(record.pageChangePreview),
    pagePreview: readRenderedPagePreview(record.pagePreview),
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
      .filter((link) => link.label && link.url)
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
      .filter((card) => card.label && card.value && card.body),
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

function readEnv(key: string) {
  return process.env[key]?.trim() ?? "";
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/^https?:\/\/[^/]+/i, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
