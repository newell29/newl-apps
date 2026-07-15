import { WebsiteGrowthAction, WebsiteGrowthContentDraftSource } from "@prisma/client";

import {
  getNewlWebsitePatternForOpportunity,
  newlWebsiteContext,
  type NewlWebsiteContext
} from "@/modules/website-growth/newl-website-context";
import { resolveNewlWebsiteContext } from "@/modules/website-growth/newl-website-context-scanner";
import { generateWebsiteGrowthContentDraft, isOpenAiDraftGenerationConfigured } from "@/server/integrations/openai";

export type WebsiteGrowthDraftOpportunity = {
  action: WebsiteGrowthAction;
  topic: string;
  primaryKeyword: string | null;
  targetPage: string | null;
  sourcePage: string | null;
  score: number;
  confidence: string | null;
  reason: string;
  recommendation: string;
  supportingKeywords: unknown;
  evidence: unknown;
};

export type WebsiteGrowthDraftSection = {
  heading: string;
  purpose: string;
  draftCopy: string;
};

export type WebsiteGrowthContentDraftPayload = {
  title: string;
  summary: string;
  contentType: string;
  proposedPath: string | null;
  targetKeyword: string;
  searchIntent: string;
  sections: WebsiteGrowthDraftSection[];
  metaTitle: string;
  metaDescription: string;
  faqs: Array<{ question: string; answer: string }>;
  internalLinks: Array<{ label: string; url: string; reason: string }>;
  implementationNotes: string[];
  reviewChecklist: string[];
  websitePageType: string;
  websiteTemplate: string;
  layoutComponents: string[];
  designSystemNotes: string[];
};

export type WebsiteGrowthContentDraftResult = WebsiteGrowthContentDraftPayload & {
  source: WebsiteGrowthContentDraftSource;
  rawResponse: Record<string, unknown> | null;
};

export async function createWebsiteGrowthContentDraftPayload(
  opportunity: WebsiteGrowthDraftOpportunity
): Promise<WebsiteGrowthContentDraftResult> {
  const websiteContext = await resolveNewlWebsiteContext();
  const proposedPath = buildProposedPath(opportunity);
  const pagePattern = getNewlWebsitePatternForOpportunity(opportunity.action, opportunity.targetPage, proposedPath, websiteContext);

  if (isOpenAiDraftGenerationConfigured()) {
    try {
      const generated = await generateWebsiteGrowthContentDraft({
        model: process.env.OPENAI_WEBSITE_GROWTH_MODEL?.trim() || "gpt-5-mini",
        opportunity: serializeOpportunity(opportunity),
        websiteContext,
        pagePattern
      });

      return {
        ...generated,
        source: WebsiteGrowthContentDraftSource.AI
      };
    } catch {
      return {
        ...buildTemplateWebsiteGrowthContentDraft(opportunity, websiteContext),
        source: WebsiteGrowthContentDraftSource.TEMPLATE,
        rawResponse: null
      };
    }
  }

  return {
    ...buildTemplateWebsiteGrowthContentDraft(opportunity, websiteContext),
    source: WebsiteGrowthContentDraftSource.TEMPLATE,
    rawResponse: null
  };
}

export function buildTemplateWebsiteGrowthContentDraft(
  opportunity: WebsiteGrowthDraftOpportunity,
  websiteContext = newlWebsiteContext
): WebsiteGrowthContentDraftPayload {
  const keyword = opportunity.primaryKeyword || opportunity.topic;
  const contentType = getContentType(opportunity.action);
  const proposedPath = buildProposedPath(opportunity);
  const targetUrl = opportunity.targetPage || proposedPath || "/resources/logistics-insights";
  const supportingKeywords = readStringArray(opportunity.supportingKeywords);
  const pagePattern = getNewlWebsitePatternForOpportunity(opportunity.action, opportunity.targetPage, proposedPath, websiteContext);

  return {
    title: buildTitle(opportunity),
    summary: `Prepared SEO proposal for ${opportunity.topic}. This draft uses Search Console, lead, and queue evidence to outline what should be built or improved before anything is published.`,
    contentType,
    proposedPath,
    targetKeyword: keyword,
    searchIntent: inferSearchIntent(opportunity),
    sections: buildSections(opportunity, supportingKeywords),
    metaTitle: trimForMeta(`${titleCase(opportunity.topic)} | Newl Logistics`, 60),
    metaDescription: trimForMeta(
      `Review Newl's approach to ${opportunity.topic.toLowerCase()} with warehousing, fulfillment, freight, WMS visibility, and Canada-U.S. distribution support.`,
      155
    ),
    faqs: [
      {
        question: `How does Newl support ${opportunity.topic.toLowerCase()}?`,
        answer:
          "Newl connects warehousing, fulfillment, inventory visibility, and freight coordination so customers can manage the operating model through one logistics partner."
      },
      {
        question: "When should this be handled as a warehouse-led program?",
        answer:
          "It should be reviewed as a warehouse-led program when inventory placement, order flow, compliance, reporting, or carrier handoffs affect service levels."
      }
    ],
    internalLinks: [
      {
        label: "Warehousing services",
        url: "/services/warehousing-services",
        reason: "Connects the topic back to the core commercial warehousing page."
      },
      {
        label: "Warehouse inventory management",
        url: "/services/warehouse-inventory-management",
        reason: "Supports Teamship WMS and visibility claims."
      },
      {
        label: "Contact Newl",
        url: "/resources/contact",
        reason: "Gives the reader a clear conversion path."
      }
    ],
    implementationNotes: [
      `Primary review page: ${targetUrl}`,
      `Use Newl website pattern: ${pagePattern.pageType} (${pagePattern.sourceTemplate}).`,
      `Recommended component sequence: ${pagePattern.componentSequence.join(" -> ")}.`,
      buildSiteInventoryNote(websiteContext),
      `Recommended queue action: ${formatAction(opportunity.action)}`,
      "Keep claims specific to known Newl capabilities and avoid unsupported guarantees.",
      "After approval, build or update the website page, verify internal links, then resubmit the sitemap in Search Console if a new URL is created."
    ],
    reviewChecklist: [
      "Does the title match the search intent?",
      "Does the page clearly connect warehousing, fulfillment, freight, or Teamship where relevant?",
      "Are customer proof points or examples available for this topic?",
      "Is there a clear CTA and internal link path to a commercial page?",
      "Does the proposed URL avoid duplicating an existing page?",
      `Does the draft follow the ${pagePattern.pageType} component pattern?`
    ],
    websitePageType: pagePattern.pageType,
    websiteTemplate: pagePattern.sourceTemplate,
    layoutComponents: pagePattern.componentSequence,
    designSystemNotes: pagePattern.designNotes
  };
}

function buildSiteInventoryNote(websiteContext: NewlWebsiteContext) {
  const inventory = websiteContext.siteInventory;

  if (!inventory || inventory.source !== "repo-scan") {
    return "Site context source: built-in Newl website pattern library.";
  }

  return `Site context source: repo scan at ${inventory.scannedAt}; ${inventory.routes.length} routes, ${inventory.templates.length} templates, ${inventory.internalLinks.length} internal links sampled.`;
}

function serializeOpportunity(opportunity: WebsiteGrowthDraftOpportunity) {
  return {
    action: opportunity.action,
    topic: opportunity.topic,
    primaryKeyword: opportunity.primaryKeyword,
    targetPage: opportunity.targetPage,
    sourcePage: opportunity.sourcePage,
    score: opportunity.score,
    confidence: opportunity.confidence,
    reason: opportunity.reason,
    recommendation: opportunity.recommendation,
    supportingKeywords: readStringArray(opportunity.supportingKeywords),
    evidence: isRecord(opportunity.evidence) ? opportunity.evidence : {}
  };
}

function getContentType(action: WebsiteGrowthAction) {
  switch (action) {
    case WebsiteGrowthAction.CREATE_PAGE:
      return "New commercial page";
    case WebsiteGrowthAction.IMPROVE_EXISTING_PAGE:
      return "Existing page improvement";
    case WebsiteGrowthAction.ADD_SECTION:
      return "New page section";
    case WebsiteGrowthAction.ADD_INTERNAL_LINKS:
      return "Internal linking update";
    case WebsiteGrowthAction.CREATE_RESOURCE_ARTICLE:
      return "Resource article";
    case WebsiteGrowthAction.UPDATE_REDIRECT:
      return "Redirect and page mapping";
    default:
      return "SEO monitoring brief";
  }
}

function buildTitle(opportunity: WebsiteGrowthDraftOpportunity) {
  if (opportunity.action === WebsiteGrowthAction.CREATE_RESOURCE_ARTICLE) {
    return `${titleCase(opportunity.topic)} Guide`;
  }

  if (opportunity.action === WebsiteGrowthAction.ADD_SECTION) {
    return `Add ${titleCase(opportunity.topic)} Section`;
  }

  if (opportunity.action === WebsiteGrowthAction.ADD_INTERNAL_LINKS) {
    return `Internal Link Plan for ${titleCase(opportunity.topic)}`;
  }

  return `${titleCase(opportunity.topic)} SEO Proposal`;
}

function buildProposedPath(opportunity: WebsiteGrowthDraftOpportunity) {
  if (opportunity.action === WebsiteGrowthAction.IMPROVE_EXISTING_PAGE || opportunity.action === WebsiteGrowthAction.ADD_SECTION) {
    return normalizePath(opportunity.targetPage);
  }

  const slug = slugify(opportunity.topic);

  if (!slug) {
    return null;
  }

  if (opportunity.action === WebsiteGrowthAction.CREATE_RESOURCE_ARTICLE) {
    return `/resources/${slug}`;
  }

  if (opportunity.action === WebsiteGrowthAction.CREATE_PAGE) {
    return `/services/${slug}`;
  }

  return normalizePath(opportunity.targetPage);
}

function buildSections(opportunity: WebsiteGrowthDraftOpportunity, supportingKeywords: string[]) {
  const keywordList = supportingKeywords.length > 0 ? supportingKeywords.join(", ") : opportunity.primaryKeyword ?? opportunity.topic;

  if (opportunity.action === WebsiteGrowthAction.ADD_INTERNAL_LINKS) {
    return [
      {
        heading: "Internal Link Targets",
        purpose: "Identify where this topic should be reinforced across the site.",
        draftCopy: `Add contextual links for ${keywordList} from relevant warehousing, freight, location, and industry pages to the strongest matching destination.`
      },
      {
        heading: "Anchor Text Guidance",
        purpose: "Keep links natural and useful for users.",
        draftCopy: `Use descriptive anchors such as ${opportunity.primaryKeyword ?? opportunity.topic}, warehouse-led logistics, Teamship WMS visibility, or Newl distribution support where they fit the page copy.`
      }
    ];
  }

  return [
    {
      heading: `${titleCase(opportunity.topic)} Overview`,
      purpose: "Open with the operational problem and why Newl is relevant.",
      draftCopy: `Newl supports ${opportunity.topic.toLowerCase()} by connecting warehouse operations, inventory visibility, and transportation planning under one operating model.`
    },
    {
      heading: "Where This Fits in the Operating Model",
      purpose: "Tie the content back to Newl's warehousing-led strategy.",
      draftCopy:
        "The page should explain how receiving, storage, order flow, compliance, reporting, and freight handoffs work together instead of presenting the service as a standalone task."
    },
    {
      heading: "What Customers Should Review",
      purpose: "Turn the content into a practical decision aid.",
      draftCopy: `Customers evaluating ${keywordList} should review inventory location, order channels, volume profile, visibility requirements, service-level expectations, and carrier handoffs before selecting a logistics partner.`
    },
    {
      heading: "Why Newl",
      purpose: "Close with proof-oriented reasons to contact Newl.",
      draftCopy:
        "Newl can support programs through Mississauga and Charlotte warehouse hubs, Teamship WMS visibility, Canada-U.S. distribution coordination, and freight options across ground, ocean, air, and cross-border movement."
    }
  ];
}

function inferSearchIntent(opportunity: WebsiteGrowthDraftOpportunity) {
  const topic = opportunity.topic.toLowerCase();

  if (topic.includes("what is") || topic.includes("how to") || topic.includes("definition")) {
    return "Informational";
  }

  if (opportunity.action === WebsiteGrowthAction.CREATE_PAGE || opportunity.action === WebsiteGrowthAction.IMPROVE_EXISTING_PAGE) {
    return "Commercial";
  }

  return "Mixed";
}

function readStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function normalizePath(value: string | null) {
  if (!value) {
    return null;
  }

  try {
    const parsed = new URL(value);
    return parsed.pathname || "/";
  } catch {
    return value.startsWith("/") ? value : `/${value}`;
  }
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function titleCase(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function trimForMeta(value: string, maxLength: number) {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 1).trimEnd()}.`;
}

function formatAction(action: WebsiteGrowthAction) {
  return action
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
