import { WebsiteGrowthAction, WebsiteGrowthContentDraftSource } from "@prisma/client";

import {
  getNewlWebsitePatternForOpportunity,
  newlWebsiteContext,
  type NewlWebsiteContext
} from "@/modules/website-growth/newl-website-context";
import { resolveNewlWebsiteContext } from "@/modules/website-growth/newl-website-context-scanner";
import { resolveLegacyPageRebuild } from "@/modules/website-growth/legacy-rebuilds";
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

export type WebsiteGrowthPageChangePreview = {
  currentPage: {
    path: string;
    pageType: string;
    role: string;
    likelySourceFiles: string[];
    existingComponents: string[];
    currentFocus: string;
  };
  proposedChanges: Array<{
    changeType: "meta" | "hero" | "section" | "faq" | "internal_links" | "cta" | "redirect" | "technical";
    location: string;
    currentState: string;
    proposedState: string;
    exactDraftCopy?: string;
    reason: string;
    impact: string;
  }>;
  visualReviewNotes: string[];
  approvalSummary: string;
};

export type WebsiteGrowthRenderedPagePreview = {
  mode: "new_page" | "existing_page_update" | "legacy_redirect_rebuild" | "internal_link_update";
  eyebrow: string;
  heroTitle: string;
  heroCopy: string;
  heroBullets: string[];
  primaryCta: string;
  secondaryCta: string;
  proofCards: Array<{
    label: string;
    value: string;
    body: string;
  }>;
  sections: Array<{
    eyebrow: string;
    heading: string;
    body: string;
    cards: Array<{
      title: string;
      body: string;
    }>;
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
  finalCta: {
    heading: string;
    body: string;
    buttonLabel: string;
  };
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
  pageChangePreview: WebsiteGrowthPageChangePreview;
  pagePreview: WebsiteGrowthRenderedPagePreview;
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
      const legacyRebuild = resolveLegacyPageRebuild(opportunity);
      const generatedProposedPath = generated.proposedPath ?? proposedPath;
      const targetUrl = resolveDraftTargetUrl(opportunity, generatedProposedPath, legacyRebuild);
      const fallbackPagePreview = buildRenderedPagePreview({
        opportunity,
        sections: generated.sections,
        faqs: generated.faqs,
        internalLinks: generated.internalLinks,
        legacyRebuild
      });
      const pagePreview =
        generated.pagePreview && !shouldReplaceGeneratedPagePreview(opportunity, generated.pagePreview)
          ? generated.pagePreview
          : fallbackPagePreview;

      return {
        ...generated,
        pageChangePreview: buildPageChangePreview({
          opportunity,
          proposedPath: generatedProposedPath,
          targetUrl,
          pagePattern,
          websiteContext,
          sections: generated.sections,
          metaTitle: generated.metaTitle,
          metaDescription: generated.metaDescription,
          legacyRebuild
        }),
        pagePreview,
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
  const legacyRebuild = resolveLegacyPageRebuild(opportunity);
  const contentType = getContentType(opportunity.action, legacyRebuild, opportunity.targetPage);
  const proposedPath = buildProposedPath(opportunity);
  const targetUrl = resolveDraftTargetUrl(opportunity, proposedPath, legacyRebuild);
  const supportingKeywords = readStringArray(opportunity.supportingKeywords);
  const pagePattern = getNewlWebsitePatternForOpportunity(opportunity.action, opportunity.targetPage, proposedPath, websiteContext);
  const glossaryTerm = isGlossaryIntent(opportunity) ? getGlossaryTerm(opportunity) : null;
  const sections = buildSections(opportunity, supportingKeywords);
  const metaTitle = glossaryTerm
    ? trimForMeta(`${buildGlossaryQuestion(glossaryTerm)} | Newl`, 60)
    : trimForMeta(`${titleCase(opportunity.topic)} | Newl Logistics`, 60);
  const metaDescription = glossaryTerm
    ? trimForMeta(
        `Learn what ${glossaryTerm.toLowerCase()} means in warehouse operations, why it matters for inventory visibility and workflow, and when to review warehouse setup with Newl.`,
        155
      )
    : trimForMeta(
        `Review Newl's approach to ${opportunity.topic.toLowerCase()} with warehousing, fulfillment, freight, WMS visibility, and Canada-U.S. distribution support.`,
        155
      );
  const faqs = glossaryTerm
    ? buildGlossaryFaqs(glossaryTerm)
    : [
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
      ];
  const internalLinks = glossaryTerm
    ? buildGlossaryInternalLinks()
    : [
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
      ];

  return {
    title: buildTitle(opportunity, legacyRebuild),
    summary: glossaryTerm
      ? `Drafted a supporting glossary/resource page for ${glossaryTerm}. It answers the term plainly first, then connects the concept to warehouse layout, inventory visibility, and Newl's assessment path.`
      : `Drafted a Newl website page direction for ${opportunity.topic}. Review the rendered page preview, then use the implementation notes only as the build handoff.`,
    contentType: glossaryTerm ? "Glossary resource" : contentType,
    proposedPath,
    targetKeyword: keyword,
    searchIntent: inferSearchIntent(opportunity),
    sections,
    metaTitle,
    metaDescription,
    faqs,
    internalLinks,
    implementationNotes: [
      `Primary review page: ${targetUrl}`,
      legacyRebuild
        ? `Legacy rebuild: ${legacyRebuild.proposedPath} currently redirects to ${legacyRebuild.currentRedirectPath}; review this private draft before replacing the redirect.`
        : null,
      `Use Newl website pattern: ${pagePattern.pageType} (${pagePattern.sourceTemplate}).`,
      `Recommended component sequence: ${pagePattern.componentSequence.join(" -> ")}.`,
      buildSiteInventoryNote(websiteContext),
      `Recommended queue action: ${formatAction(opportunity.action)}`,
      glossaryTerm ? "Treat this as supporting glossary/resource content, not a core service page." : null,
      glossaryTerm ? "Answer the definition plainly before Newl positioning." : null,
      glossaryTerm ? "Do not force exact-match keyword wording into H1/body if it reads unnaturally." : null,
      glossaryTerm ? "If the keyword is too broad or weak, fold it into a glossary/FAQ section instead of publishing a standalone page." : null,
      "Keep claims specific to known Newl capabilities and avoid unsupported guarantees.",
      "After approval, build or update the website page, verify internal links, then resubmit the sitemap in Search Console if a new URL is created."
    ].filter((note): note is string => Boolean(note)),
    reviewChecklist: [
      "Does the title match the search intent?",
      "Does the page clearly connect warehousing, fulfillment, freight, or Teamship where relevant?",
      "Are customer proof points or examples available for this topic?",
      "Is there a clear CTA and internal link path to a commercial page?",
      "Does the proposed URL avoid duplicating an existing page?",
      glossaryTerm ? "Does this deserve a standalone resource page, or should it become a glossary/FAQ section?" : null,
      glossaryTerm ? "Does the H1 read naturally instead of repeating the raw keyword?" : null,
      `Does the draft follow the ${pagePattern.pageType} component pattern?`
    ].filter((item): item is string => Boolean(item)),
    websitePageType: pagePattern.pageType,
    websiteTemplate: pagePattern.sourceTemplate,
    layoutComponents: pagePattern.componentSequence,
    designSystemNotes: pagePattern.designNotes,
    pageChangePreview: buildPageChangePreview({
      opportunity,
      proposedPath,
      targetUrl,
      pagePattern,
      websiteContext,
      sections,
      metaTitle,
      metaDescription,
      legacyRebuild
    }),
    pagePreview: buildRenderedPagePreview({
      opportunity,
      sections,
      faqs,
      internalLinks,
      legacyRebuild
    })
  };
}

function resolveDraftTargetUrl(
  opportunity: WebsiteGrowthDraftOpportunity,
  proposedPath: string | null,
  legacyRebuild: ReturnType<typeof resolveLegacyPageRebuild>
) {
  return legacyRebuild?.proposedPath || opportunity.targetPage || proposedPath || "/resources/logistics-insights";
}

function buildSiteInventoryNote(websiteContext: NewlWebsiteContext) {
  const inventory = websiteContext.siteInventory;

  if (!inventory || inventory.source !== "repo-scan") {
    return "Site context source: built-in Newl website pattern library.";
  }

  return `Site context source: repo scan at ${inventory.scannedAt}; ${inventory.routes.length} routes, ${inventory.templates.length} templates, ${inventory.internalLinks.length} internal links sampled.`;
}

function buildPageChangePreview({
  opportunity,
  proposedPath,
  targetUrl,
  pagePattern,
  websiteContext,
  sections,
  metaTitle,
  metaDescription,
  legacyRebuild
}: {
  opportunity: WebsiteGrowthDraftOpportunity;
  proposedPath: string | null;
  targetUrl: string;
  pagePattern: ReturnType<typeof getNewlWebsitePatternForOpportunity>;
  websiteContext: NewlWebsiteContext;
  sections: WebsiteGrowthDraftSection[];
  metaTitle: string;
  metaDescription: string;
  legacyRebuild: ReturnType<typeof resolveLegacyPageRebuild>;
}): WebsiteGrowthPageChangePreview {
  const currentPath = normalizePath(opportunity.targetPage) ?? normalizePath(opportunity.sourcePage) ?? proposedPath ?? "/";
  const sourceFiles = inferLikelySourceFiles(currentPath, pagePattern.sourceTemplate);
  const pageMode = resolveRenderedPageMode(opportunity, legacyRebuild);
  const isExistingPageWork = pageMode === "existing_page_update" || pageMode === "internal_link_update";
  const routeMatch = websiteContext.siteInventory?.routes.find((route) => normalizePath(route.path) === currentPath);
  const primarySection = sections[0];
  const secondarySection = sections[1];
  const proposedChanges: WebsiteGrowthPageChangePreview["proposedChanges"] = [];

  proposedChanges.push({
    changeType: "meta",
    location: "Page metadata",
    currentState: isExistingPageWork
      ? "Keep the existing route, but review whether the title and description match the keyword opportunity."
      : "Create metadata for the proposed route before it is published.",
    proposedState: `${metaTitle} | ${metaDescription}`,
    reason: `Align the page with ${opportunity.primaryKeyword || opportunity.topic} search intent.`,
    impact: "Improves search result clarity and gives the approved build a specific SEO target."
  });

  if (primarySection) {
    proposedChanges.push({
      changeType: "section",
      location: isExistingPageWork ? inferSectionPlacement(currentPath, opportunity.action) : "New page body after the hero",
      currentState: isExistingPageWork
        ? "The existing page should keep its current hero, CTA, proof, and layout pattern."
        : "No dedicated page section exists yet for this opportunity.",
      proposedState: `Add or revise a section titled "${primarySection.heading}".`,
      exactDraftCopy: primarySection.draftCopy,
      reason: primarySection.purpose || "Support the main SEO opportunity with practical Newl-specific copy.",
      impact: "Makes the recommendation visible in the actual page flow instead of leaving it as an external instruction."
    });
  }

  if (secondarySection) {
    proposedChanges.push({
      changeType: "section",
      location: isExistingPageWork ? "Supporting content band before FAQ or related services" : "Second content band",
      currentState: "The page needs a stronger explanation of how the topic connects to Newl's operating model.",
      proposedState: `Add supporting copy under "${secondarySection.heading}".`,
      exactDraftCopy: secondarySection.draftCopy,
      reason: secondarySection.purpose,
      impact: "Connects the keyword to warehousing, Teamship visibility, freight handoffs, and conversion intent."
    });
  }

  proposedChanges.push({
    changeType: "faq",
    location: "FAQAccordionSection or FAQGrid",
    currentState: "Use the existing FAQ component pattern where the page already has one, or add the standard FAQ section before the final CTA.",
    proposedState: "Add the draft FAQ questions that answer the searcher's decision concerns.",
    reason: "FAQs help capture long-tail search intent and reduce friction before the contact form.",
    impact: "Strengthens topical coverage without making the main page body too heavy."
  });

  proposedChanges.push({
    changeType: "internal_links",
    location: "RelatedServicesSection, InternalLinksSection, or contextual body links",
    currentState: "Review current links so the page does not become isolated or self-referential.",
    proposedState: "Add the recommended internal links using existing Newl card/link/button patterns.",
    reason: "Routes users from informational intent to commercial pages and reinforces the warehouse-led model.",
    impact: "Improves crawl paths and gives visitors a clearer path to the assessment form."
  });

  if (legacyRebuild) {
    proposedChanges.unshift({
      changeType: "redirect",
      location: legacyRebuild.proposedPath,
      currentState: `${legacyRebuild.proposedPath} currently redirects to ${legacyRebuild.currentRedirectPath}.`,
      proposedState: `Review a rebuilt page at ${legacyRebuild.proposedPath} before replacing the redirect.`,
      reason: "The URL already has search evidence and should not be blindly redirected if it deserves a dedicated page.",
      impact: "Preserves useful legacy demand while keeping approval safely draft-first."
    });
  }

  return {
    currentPage: {
      path: currentPath,
      pageType: routeMatch?.type || pagePattern.pageType,
      role: inferCurrentPageRole(currentPath, pagePattern.pageType, opportunity.action),
      likelySourceFiles: sourceFiles,
      existingComponents: pagePattern.componentSequence,
      currentFocus: inferCurrentFocus(currentPath, pagePattern.pageType)
    },
    proposedChanges,
    visualReviewNotes: [
      "Review the existing page route first, then compare the proposed section placement and copy against the live page flow.",
      "The approval should result in a Vercel preview that uses actual Newl website components, spacing, CTAs, FAQ styling, and contact form behavior.",
      "Do not approve if the proposal creates a duplicate page for an intent that should be handled by an existing service, freight, industry, location, or resource page."
    ],
    approvalSummary: `If approved, update ${targetUrl} with the proposed metadata, section copy, FAQ/internal link changes, and Newl website component pattern before publishing.`
  };
}

function inferLikelySourceFiles(path: string, sourceTemplate: string) {
  if (path === "/") {
    return ["app/page.tsx", "app/homepage-prototype/page.tsx", "components/site-header.tsx"];
  }

  if (path.startsWith("/services/")) {
    return ["lib/pages/services.ts", sourceTemplate];
  }

  if (path.startsWith("/freight/")) {
    return ["lib/pages/freight.ts", sourceTemplate];
  }

  if (path.startsWith("/industries/")) {
    return ["lib/pages/industries.ts", "lib/industries/pages.ts", sourceTemplate];
  }

  if (path.startsWith("/locations/")) {
    return ["lib/pages/locations.ts", sourceTemplate];
  }

  if (path.startsWith("/resources/")) {
    return [`app${path}/page.tsx`, "components/page-layout.tsx"];
  }

  return [sourceTemplate];
}

function inferSectionPlacement(path: string, action: WebsiteGrowthAction) {
  if (action === WebsiteGrowthAction.ADD_INTERNAL_LINKS) {
    return "Existing body copy, related services, or internal links section";
  }

  if (path === "/") {
    return "Homepage proof/operating-model area before the core service bands";
  }

  if (path.startsWith("/industries/")) {
    return "Industry operations section before customer examples";
  }

  if (path.startsWith("/locations/")) {
    return "Location capabilities or service-area section before FAQ";
  }

  if (path.startsWith("/freight/")) {
    return "Freight-to-warehouse connection section before process steps";
  }

  return "Problem/fit or capabilities section before FAQ";
}

function inferCurrentPageRole(path: string, pageType: string, action: WebsiteGrowthAction) {
  if (path === "/") {
    return "Homepage positioning and lead conversion entry point.";
  }

  if (action === WebsiteGrowthAction.ADD_INTERNAL_LINKS) {
    return "Existing page that should help route readers to a stronger destination.";
  }

  return `Existing ${pageType.toLowerCase()} used as the primary page for this search intent.`;
}

function inferCurrentFocus(path: string, pageType: string) {
  if (path === "/") {
    return "Explain Newl's warehouse-led operating model and move qualified visitors toward an assessment.";
  }

  if (path.startsWith("/services/")) {
    return "Commercial service conversion with capabilities, fit, FAQ, related services, and assessment CTA.";
  }

  if (path.startsWith("/freight/")) {
    return "Freight service conversion while tying carrier movement back to warehouse readiness and inventory handoffs.";
  }

  if (path.startsWith("/industries/")) {
    return "Industry-specific logistics proof, examples, service fit, and conversion path.";
  }

  if (path.startsWith("/locations/")) {
    return "Location or network coverage proof with facility/service-area specifics and local conversion intent.";
  }

  return `${pageType} content that should follow Newl's existing page structure and conversion path.`;
}

function buildRenderedPagePreview({
  opportunity,
  sections,
  faqs,
  internalLinks,
  legacyRebuild
}: {
  opportunity: WebsiteGrowthDraftOpportunity;
  sections: WebsiteGrowthDraftSection[];
  faqs: WebsiteGrowthRenderedPagePreview["faqs"];
  internalLinks: WebsiteGrowthRenderedPagePreview["internalLinks"];
  legacyRebuild: ReturnType<typeof resolveLegacyPageRebuild>;
}): WebsiteGrowthRenderedPagePreview {
  if (isGlossaryIntent(opportunity)) {
    return buildGlossaryRenderedPagePreview({
      opportunity,
      sections,
      faqs,
      internalLinks,
      legacyRebuild
    });
  }

  const topic = titleCase(opportunity.topic);
  const keyword = opportunity.primaryKeyword || opportunity.topic;
  const mode = resolveRenderedPageMode(opportunity, legacyRebuild);
  const pageSections = sections.length > 0 ? sections : buildSections(opportunity, []);
  const heroTitle =
    mode === "internal_link_update"
      ? `Connect ${topic.toLowerCase()} into Newl's warehouse-led logistics model.`
      : `${topic} with warehousing, visibility, and freight execution.`;
  const heroCopy =
    legacyRebuild
      ? `Newl can rebuild ${legacyRebuild.proposedPath} into a focused page for customers comparing ${keyword.toLowerCase()} options, showing how warehousing, fulfillment, Teamship WMS visibility, and freight handoffs work as one operating model.`
      : `Newl helps importers, manufacturers, distributors, and growing brands handle ${keyword.toLowerCase()} through warehouse-controlled inventory, Teamship WMS visibility, and coordinated freight execution across Canada and the U.S.`;

  return {
    mode,
    eyebrow: "WAREHOUSE-LED LOGISTICS",
    heroTitle,
    heroCopy,
    heroBullets: [
      "Warehouse-led operating model",
      "Teamship WMS visibility",
      "Canada + U.S. distribution support"
    ],
    primaryCta: "Request Logistics Review",
    secondaryCta: "Talk to Newl",
    proofCards: [
      {
        label: "Visibility",
        value: "Teamship WMS",
        body: "Inventory, inbound activity, order status, exceptions, and reporting stay visible through Newl's proprietary WMS."
      },
      {
        label: "Network",
        value: "2 owned hubs",
        body: "Mississauga and Charlotte warehouse operations connect to regional, cross-border, and partner coverage."
      },
      {
        label: "Execution",
        value: "Warehouse + freight",
        body: "Storage, fulfillment, routing, ground distribution, ocean, air, and cross-border handoffs are planned together."
      }
    ],
    sections: pageSections.slice(0, 4).map((section, index) => ({
      eyebrow: index === 0 ? "OPERATING FIT" : "NEWL CAPABILITY",
      heading: section.heading,
      body: section.draftCopy,
      cards: [
        {
          title: "Where this matters",
          body: section.purpose || "This page explains the operational fit between the search topic, inventory placement, workflow, visibility, and freight handoffs."
        },
        {
          title: "How Newl supports it",
          body: "Newl connects owned warehouse hubs, Teamship WMS visibility, and freight coordination so customers can manage the work through one logistics partner."
        }
      ]
    })),
    faqs,
    internalLinks,
    finalCta: {
      heading: `Review ${topic.toLowerCase()} with Newl.`,
      body: `Share your inventory profile, service requirements, locations, and timeline so Newl can recommend the right warehouse-led logistics plan.`,
      buttonLabel: "Request Assessment"
    }
  };
}

function buildGlossaryRenderedPagePreview({
  opportunity,
  sections,
  faqs,
  internalLinks,
  legacyRebuild
}: {
  opportunity: WebsiteGrowthDraftOpportunity;
  sections: WebsiteGrowthDraftSection[];
  faqs: WebsiteGrowthRenderedPagePreview["faqs"];
  internalLinks: WebsiteGrowthRenderedPagePreview["internalLinks"];
  legacyRebuild: ReturnType<typeof resolveLegacyPageRebuild>;
}): WebsiteGrowthRenderedPagePreview {
  const term = getGlossaryTerm(opportunity);
  const lowerTerm = term.toLowerCase();
  const definition = buildGlossaryDefinition(term);
  const mode = resolveRenderedPageMode(opportunity, legacyRebuild);
  const pageSections = sections.length > 0 ? sections : buildGlossarySections(opportunity);

  return {
    mode,
    eyebrow: "WAREHOUSE GLOSSARY",
    heroTitle: buildGlossaryQuestion(term),
    heroCopy: `${definition} Newl connects warehouse layout, location control, Teamship WMS visibility, and freight-ready workflows so operational details translate into better inventory control.`,
    heroBullets: ["Plain-language definition", "Warehouse layout context", "Inventory visibility connection"],
    primaryCta: "Review Warehouse Setup",
    secondaryCta: "Talk to Newl",
    proofCards: [
      {
        label: "Definition",
        value: term,
        body: definition
      },
      {
        label: "Why it matters",
        value: "Flow + accuracy",
        body: `${term} details can affect travel paths, pick accuracy, replenishment, staging, and safe movement through the facility.`
      },
      {
        label: "Newl lens",
        value: "Visibility",
        body: "Warehouse terms become useful when they connect to WMS locations, operating rules, exception reporting, and customer-facing visibility."
      }
    ],
    sections: pageSections.slice(0, 4).map((section, index) => ({
      eyebrow: index === 0 ? "WAREHOUSE BASICS" : "NEWL LENS",
      heading: section.heading,
      body: section.draftCopy,
      cards: [
        {
          title: "Operational takeaway",
          body: section.purpose || `Understand how ${lowerTerm} affects warehouse flow, storage, picking, and inventory control.`
        },
        {
          title: "Newl connection",
          body: "Newl ties warehouse layout, location records, Teamship WMS visibility, and freight handoffs into one operating model."
        }
      ]
    })),
    faqs: faqs.length > 0 ? faqs : buildGlossaryFaqs(term),
    internalLinks: internalLinks.length > 0 ? internalLinks : buildGlossaryInternalLinks(),
    finalCta: {
      heading: "Need a warehouse layout and inventory visibility review?",
      body: "Share your inventory profile, storage constraints, order channels, and service requirements so Newl can review whether the warehouse setup supports the work.",
      buttonLabel: "Request Assessment"
    }
  };
}

function shouldReplaceGeneratedPagePreview(
  opportunity: WebsiteGrowthDraftOpportunity,
  preview: WebsiteGrowthRenderedPagePreview
) {
  if (!isGlossaryIntent(opportunity)) {
    return false;
  }

  const keyword = (opportunity.primaryKeyword || opportunity.topic).toLowerCase();
  const topic = opportunity.topic.toLowerCase();
  const content = [
    preview.heroTitle,
    preview.heroCopy,
    ...preview.heroBullets,
    ...preview.proofCards.flatMap((card) => [card.label, card.value, card.body]),
    ...preview.sections.flatMap((section) => [
      section.eyebrow,
      section.heading,
      section.body,
      ...section.cards.flatMap((card) => [card.title, card.body])
    ]),
    ...preview.faqs.flatMap((faq) => [faq.question, faq.answer]),
    preview.finalCta.heading,
    preview.finalCta.body
  ]
    .join(" ")
    .toLowerCase();

  const badPhrases = [
    `handle ${keyword}`,
    `supports ${keyword}`,
    `${topic} with warehousing`,
    `${keyword} with warehousing`,
    `helps customers handle ${keyword}`,
    `helps importers, manufacturers, distributors, and growing brands handle ${keyword}`
  ];

  return badPhrases.some((phrase) => content.includes(phrase)) || (!content.includes("mean") && !content.includes("definition"));
}

function resolveRenderedPageMode(
  opportunity: WebsiteGrowthDraftOpportunity,
  legacyRebuild: ReturnType<typeof resolveLegacyPageRebuild>
): WebsiteGrowthRenderedPagePreview["mode"] {
  if (legacyRebuild) {
    return "legacy_redirect_rebuild";
  }

  if (opportunity.action === WebsiteGrowthAction.ADD_INTERNAL_LINKS) {
    return "internal_link_update";
  }

  if (
    opportunity.action === WebsiteGrowthAction.CREATE_PAGE ||
    opportunity.action === WebsiteGrowthAction.CREATE_RESOURCE_ARTICLE ||
    opportunity.action === WebsiteGrowthAction.UPDATE_REDIRECT ||
    (opportunity.action === WebsiteGrowthAction.ADD_SECTION && !opportunity.targetPage)
  ) {
    return "new_page";
  }

  return "existing_page_update";
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

function getContentType(
  action: WebsiteGrowthAction,
  legacyRebuild?: ReturnType<typeof resolveLegacyPageRebuild>,
  targetPage?: string | null
) {
  if (legacyRebuild) {
    return "Legacy redirect rebuild";
  }

  switch (action) {
    case WebsiteGrowthAction.CREATE_PAGE:
      return "New commercial page";
    case WebsiteGrowthAction.IMPROVE_EXISTING_PAGE:
      return "Existing page improvement";
    case WebsiteGrowthAction.ADD_SECTION:
      return targetPage ? "Existing page section" : "Dedicated page draft";
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

function isGlossaryIntent(opportunity: WebsiteGrowthDraftOpportunity) {
  const phrase = `${opportunity.topic} ${opportunity.primaryKeyword ?? ""}`.toLowerCase();

  return ["meaning", "definition", "what is", "what does", "glossary", "how to"].some((term) => phrase.includes(term));
}

function getGlossaryTerm(opportunity: WebsiteGrowthDraftOpportunity) {
  const base = (opportunity.primaryKeyword || opportunity.topic).toLowerCase();
  const cleaned = base
    .replace(/\?/g, "")
    .replace(/\bwhat\s+is\b/g, "")
    .replace(/\bwhat\s+does\b/g, "")
    .replace(/\bdefinition\s+of\b/g, "")
    .replace(/\bmeaning\s+of\b/g, "")
    .replace(/\bmeaning\s+in\s+a?\s*warehouse\b/g, "")
    .replace(/\bwarehouse\s+meaning\b/g, "")
    .replace(/\bin\s+a?\s*warehouse\b/g, "")
    .replace(/\bwarehouse\b/g, "")
    .replace(/\bdefinition\b/g, "")
    .replace(/\bmeaning\b/g, "")
    .replace(/\s+/g, " ")
    .trim();

  return titleCase(cleaned || base);
}

function buildGlossaryQuestion(term: string) {
  return `What does ${term.toLowerCase()} mean in a warehouse?`;
}

function indefiniteArticleFor(value: string) {
  return /^[aeiou]/i.test(value.trim()) ? "an" : "a";
}

function buildGlossaryDefinition(term: string) {
  const lowerTerm = term.toLowerCase();

  if (lowerTerm === "aisle") {
    return "In warehouse operations, an aisle is the open path between racks, shelving, pallets, dock lanes, or work zones. It gives workers and equipment room to travel, pick, replenish, inspect, and move inventory.";
  }

  return `In warehouse operations, ${indefiniteArticleFor(term)} ${lowerTerm} is a term used to describe a warehouse location, workflow, document, or handling concept. The useful answer is not just the definition; it is how the term affects inventory control, service levels, and day-to-day warehouse execution.`;
}

function buildGlossarySections(opportunity: WebsiteGrowthDraftOpportunity) {
  const term = getGlossaryTerm(opportunity);
  const lowerTerm = term.toLowerCase();

  return [
    {
      heading: `Warehouse ${lowerTerm} definition`,
      purpose: "Answer the glossary term plainly before introducing Newl.",
      draftCopy: buildGlossaryDefinition(term)
    },
    {
      heading: `Why ${lowerTerm} matters in warehouse operations`,
      purpose: "Explain the operational relevance without pretending the glossary term is a service.",
      draftCopy: `${term} details can affect travel paths, pick accuracy, replenishment, staging, safety, and how quickly inventory moves through a facility. A simple term can point to a real workflow or layout issue when it starts causing delays, mis-picks, congestion, or poor visibility.`
    },
    {
      heading: `How ${lowerTerm} connects to inventory visibility`,
      purpose: "Tie the educational topic back to Teamship and location control.",
      draftCopy:
        "The term becomes useful when it is connected to location records, WMS rules, cycle counts, inbound workflows, order picking, and exception reporting. Teamship gives customers a practical view of inventory, inbound activity, orders, and reporting so warehouse details are not managed only through spreadsheets or status emails."
    },
    {
      heading: "When to review the warehouse setup",
      purpose: "Create a natural conversion path from definition to assessment.",
      draftCopy:
        "A warehouse review is worth considering when layout, storage rules, order flow, receiving, replenishment, or freight handoffs are creating service issues. Newl can review the operating model across warehousing, fulfillment, WMS visibility, and distribution before recommending changes."
    }
  ];
}

function buildGlossaryFaqs(term: string) {
  const lowerTerm = term.toLowerCase();

  return [
    {
      question: buildGlossaryQuestion(term),
      answer: buildGlossaryDefinition(term)
    },
    {
      question: `Why does ${lowerTerm} matter for warehouse operations?`,
      answer:
        "It matters because warehouse terminology often connects to physical layout, inventory location control, picking paths, receiving flow, safety, and service levels. When the operating rules are unclear, small issues can turn into delays or accuracy problems."
    },
    {
      question: "When should a company review its warehouse layout or workflow?",
      answer:
        "Review the setup when inventory is hard to locate, order flow is slowing down, teams are relying on spreadsheets, pick paths are inefficient, or carrier and warehouse handoffs are creating delays."
    }
  ];
}

function buildGlossaryInternalLinks() {
  return [
    {
      label: "Warehousing services",
      url: "/services/warehousing-services",
      reason: "Connects the glossary explanation to Newl's core warehouse operations page."
    },
    {
      label: "Warehouse inventory management",
      url: "/services/warehouse-inventory-management",
      reason: "Supports the Teamship WMS and inventory visibility connection."
    },
    {
      label: "Warehouse assessment",
      url: "/services/warehouse-assessment",
      reason: "Gives readers a natural next step when the definition points to a workflow or layout issue."
    },
    {
      label: "Contact Newl",
      url: "/resources/contact",
      reason: "Gives the reader a clear conversion path."
    }
  ];
}

function buildTitle(opportunity: WebsiteGrowthDraftOpportunity, legacyRebuild?: ReturnType<typeof resolveLegacyPageRebuild>) {
  if (isGlossaryIntent(opportunity)) {
    return buildGlossaryQuestion(getGlossaryTerm(opportunity));
  }

  if (legacyRebuild) {
    return `${titleCase(opportunity.topic)} Page Draft`;
  }

  if (opportunity.action === WebsiteGrowthAction.CREATE_RESOURCE_ARTICLE) {
    return `${titleCase(opportunity.topic)} Guide`;
  }

  if (opportunity.action === WebsiteGrowthAction.ADD_SECTION && opportunity.targetPage) {
    return `Add ${titleCase(opportunity.topic)} Section`;
  }

  if (opportunity.action === WebsiteGrowthAction.ADD_SECTION) {
    return `${titleCase(opportunity.topic)} Page Draft`;
  }

  if (opportunity.action === WebsiteGrowthAction.ADD_INTERNAL_LINKS) {
    return `Internal Link Plan for ${titleCase(opportunity.topic)}`;
  }

  return `${titleCase(opportunity.topic)} SEO Proposal`;
}

function buildProposedPath(opportunity: WebsiteGrowthDraftOpportunity) {
  const legacyRebuild = resolveLegacyPageRebuild(opportunity);

  if (legacyRebuild) {
    return legacyRebuild.proposedPath;
  }

  if (isGlossaryIntent(opportunity)) {
    const termSlug = slugify(getGlossaryTerm(opportunity));
    return termSlug ? `/resources/glossary/${termSlug}` : null;
  }

  if (
    (opportunity.action === WebsiteGrowthAction.IMPROVE_EXISTING_PAGE ||
      opportunity.action === WebsiteGrowthAction.ADD_SECTION) &&
    opportunity.targetPage
  ) {
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

  if (opportunity.action === WebsiteGrowthAction.ADD_SECTION) {
    return `/${slug}`;
  }

  return normalizePath(opportunity.targetPage);
}

function buildSections(opportunity: WebsiteGrowthDraftOpportunity, supportingKeywords: string[]) {
  const keywordList = supportingKeywords.length > 0 ? supportingKeywords.join(", ") : opportunity.primaryKeyword ?? opportunity.topic;

  if (isGlossaryIntent(opportunity)) {
    return buildGlossarySections(opportunity);
  }

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

  if (isGlossaryIntent(opportunity) || topic.includes("what is") || topic.includes("how to") || topic.includes("definition")) {
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
