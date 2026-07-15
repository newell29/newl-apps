import { WebsiteGrowthAction } from "@prisma/client";

export type NewlWebsitePagePattern = {
  pageType: string;
  routeFamily: string;
  sourceTemplate: string;
  componentSequence: string[];
  requiredElements: string[];
  designNotes: string[];
  conversionPattern: string;
};

export type NewlWebsiteContext = {
  brandPositioning: string[];
  visualSystem: string[];
  reusableComponents: string[];
  pagePatterns: NewlWebsitePagePattern[];
  copyRules: string[];
  seoRules: string[];
  internalLinkRules: string[];
  siteInventory?: {
    source: "static" | "repo-scan";
    scannedAt: string | null;
    repoPath: string | null;
    routes: Array<{ path: string; type: string }>;
    templates: Array<{ file: string; components: string[] }>;
    contactFormFields: string[];
    faqSignals: Array<{ file: string; count: number }>;
    internalLinks: string[];
  };
};

export const newlWebsiteContext: NewlWebsiteContext = {
  brandPositioning: [
    "Newl is a warehousing-led supply chain partner, not a generic freight broker.",
    "The strongest site message is one operating model across warehousing, fulfillment, Teamship WMS visibility, distribution, and freight.",
    "Core proof points include 35+ years in logistics, Mississauga and Charlotte warehouse hubs, Canada-U.S. coverage, Teamship WMS, NVOCC ocean freight, IATA air freight, and GTA local trucking fleet capabilities.",
    "Content should create qualified inbound conversations from importers, manufacturers, distributors, marketplace sellers, and growing brands."
  ],
  visualSystem: [
    "Use Newl's restrained dark navy, white, light blue-gray, and coral/red accent system.",
    "Keep page sections full-width and structured; do not use nested cards or decorative marketing clutter.",
    "Cards use modest radius, clear borders, compact headings, and hover red/coral treatment where they are interactive.",
    "Heroes are operational, visual, and specific: warehouse docks, Teamship dashboards, trucks, freight, customer examples, or industry-specific operations.",
    "Use concise eyebrow labels, strong H1s, practical body copy, proof chips, and one clear CTA."
  ],
  reusableComponents: [
    "PageLayout",
    "ServicePageHero",
    "ProblemFitSection",
    "CapabilitiesSection",
    "ProcessTimelineSection",
    "FulfillmentServiceSections",
    "TeamshipSections",
    "IndustryCustomerExamplesSection",
    "WarehouseNetworkSection",
    "LocationRefsSection",
    "TrustedBySection",
    "FAQAccordionSection",
    "FAQGrid",
    "WhyNewlSection",
    "RelatedServicesSection",
    "InternalLinksSection",
    "CTASection",
    "ContactForm"
  ],
  pagePatterns: [
    {
      pageType: "Service page",
      routeFamily: "/services/[slug]",
      sourceTemplate: "components/templates/ServicePageTemplate.tsx",
      componentSequence: [
        "ServicePageHero",
        "ProblemFitSection",
        "TeamshipSections or service-specific sections when relevant",
        "CapabilitiesSection",
        "ProcessTimelineSection",
        "TrustedBySection",
        "WarehouseNetworkSection or LocationRefsSection",
        "FAQAccordionSection",
        "WhyNewlSection",
        "RelatedServicesSection",
        "CTASection with ContactForm"
      ],
      requiredElements: [
        "Operational hero",
        "Problem/fit section",
        "Capabilities",
        "Process or workflow",
        "FAQ",
        "Related services",
        "Assessment CTA"
      ],
      designNotes: [
        "Commercial service pages should feel operational and conversion-oriented.",
        "Avoid blog-style introductions on service pages.",
        "Use related services to strengthen the warehouse-led model."
      ],
      conversionPattern: "Request service assessment or review."
    },
    {
      pageType: "Freight page",
      routeFamily: "/freight/[slug]",
      sourceTemplate: "lib/pages/freight.ts rendered through ServicePageTemplate",
      componentSequence: [
        "ServicePageHero",
        "ProblemFitSection",
        "CapabilitiesSection",
        "ProcessTimelineSection",
        "TrustedBySection",
        "LocationRefsSection or WarehouseNetworkSection",
        "FAQAccordionSection",
        "RelatedServicesSection",
        "CTASection with freight-specific ContactForm field"
      ],
      requiredElements: [
        "Freight mode-specific hero",
        "Warehouse-to-freight connection",
        "Carrier/routing/options language where applicable",
        "Process steps",
        "FAQ",
        "Freight-specific CTA field"
      ],
      designNotes: [
        "Always connect freight back to warehouse readiness, inventory placement, and handoffs.",
        "Avoid making freight pages read like standalone carrier brokerage pages."
      ],
      conversionPattern: "Request freight review or mode-specific assessment."
    },
    {
      pageType: "Industry page",
      routeFamily: "/industries/[slug]",
      sourceTemplate: "components/templates/IndustryPageTemplate.tsx",
      componentSequence: [
        "ServicePageHero",
        "ProblemFitSection",
        "ProcessSteps",
        "CapabilitiesSection",
        "FulfillmentServiceSections when channel fit matters",
        "IndustryCustomerExamplesSection",
        "WarehouseNetworkSection or LocationRefsSection",
        "TrustedBySection",
        "FAQGrid",
        "WhyNewlSection",
        "RelatedServicesSection",
        "InternalLinksSection",
        "CTASection with ContactForm"
      ],
      requiredElements: [
        "Industry-specific hero",
        "Industry challenges",
        "Operating model",
        "Services/capabilities",
        "Customer examples when available",
        "FAQ",
        "Related services and internal links"
      ],
      designNotes: [
        "Industry pages should use customer examples and logo proof only when supported by existing site data.",
        "They should not duplicate service pages; frame services through industry-specific operations."
      ],
      conversionPattern: "Request industry warehouse review."
    },
    {
      pageType: "Location page",
      routeFamily: "/locations/[slug]",
      sourceTemplate: "components/templates/LocationPageTemplate.tsx",
      componentSequence: [
        "ServicePageHero",
        "FacilitySnapshotSection",
        "LocationServiceAreaSection",
        "ProblemFitSection",
        "CapabilitiesSection",
        "OtherHubSection",
        "TrustedBySection",
        "FAQAccordionSection",
        "InternalLinksSection",
        "CTASection with ContactForm"
      ],
      requiredElements: [
        "Facility or network-specific hero",
        "Facility snapshot",
        "Service area",
        "Capabilities",
        "Cross-link to other hub",
        "FAQ",
        "Local or network CTA"
      ],
      designNotes: [
        "Location pages should be concrete: hub, region, facility capabilities, service area, and paired network coverage.",
        "Do not create self-referential location links."
      ],
      conversionPattern: "Request warehouse or network fit review."
    },
    {
      pageType: "Resource article",
      routeFamily: "/resources/[slug]",
      sourceTemplate: "resource pages should reuse PageLayout, SectionHeading, FAQ, internal links, and CTA patterns",
      componentSequence: [
        "Resource hero",
        "Practical answer section",
        "Decision/checklist section",
        "How Newl approaches it",
        "Related internal links",
        "FAQ",
        "CTASection or contact link"
      ],
      requiredElements: [
        "Clear answer to search intent",
        "Practical checklist or framework",
        "Newl operating model connection",
        "Internal links to commercial pages",
        "FAQ"
      ],
      designNotes: [
        "Resource articles should be helpful but still route readers toward warehousing, freight, or contact pages.",
        "Avoid generic SEO filler and unsupported claims."
      ],
      conversionPattern: "Soft CTA to contact, playbook, or relevant commercial page."
    }
  ],
  copyRules: [
    "Use Newl, Teamship, Mississauga, Charlotte, Canada-U.S., NVOCC, IATA, and GTA local trucking only where relevant.",
    "Do not invent customer names, metrics, logos, certifications, carrier contracts, or locations.",
    "Prefer operational specificity over broad claims.",
    "Use 'Newl' in body copy and 'Newl Group' in SEO titles where natural.",
    "Keep CTAs practical: review, assessment, fit, pricing, or logistics discussion."
  ],
  seoRules: [
    "Map each opportunity to one existing page or one new URL; avoid duplicate pages targeting the same intent.",
    "For an existing target page, propose a section or internal link update instead of a duplicate URL.",
    "Include meta title and meta description within normal search result lengths.",
    "Use FAQs to answer conversion and search-intent questions.",
    "Strengthen internal links to core service, freight, industry, location, contact, playbook, and case study pages."
  ],
  internalLinkRules: [
    "Core warehousing links should point to /services/warehousing-services, /services/fulfillment-services, /services/warehouse-inventory-management, and /services/amazon-fba where relevant.",
    "Freight links should point to /freight/ground-distribution, /freight/gta-local-trucking, /freight/cross-border-logistics, /freight/ocean-freight, and /freight/air-freight where relevant.",
    "Location links should include /locations/mississauga-warehousing, /locations/charlotte-warehousing, or /locations/canada-us-distribution-network where relevant.",
    "Conversion links should include /resources/contact or the page's assessment form anchor."
  ],
  siteInventory: {
    source: "static",
    scannedAt: null,
    repoPath: null,
    routes: [],
    templates: [],
    contactFormFields: [],
    faqSignals: [],
    internalLinks: []
  }
};

export function getNewlWebsitePatternForOpportunity(
  action: WebsiteGrowthAction,
  targetPage: string | null,
  proposedPath: string | null,
  context: NewlWebsiteContext = newlWebsiteContext
) {
  const path = normalizePath(targetPage) ?? normalizePath(proposedPath) ?? "";

  if (path.startsWith("/industries/")) {
    return getPattern("Industry page", context);
  }

  if (path.startsWith("/locations/")) {
    return getPattern("Location page", context);
  }

  if (path.startsWith("/freight/")) {
    return getPattern("Freight page", context);
  }

  if (path.startsWith("/resources/") || action === WebsiteGrowthAction.CREATE_RESOURCE_ARTICLE) {
    return getPattern("Resource article", context);
  }

  return getPattern("Service page", context);
}

function getPattern(pageType: string, context: NewlWebsiteContext) {
  return context.pagePatterns.find((pattern) => pattern.pageType === pageType) ?? context.pagePatterns[0];
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
