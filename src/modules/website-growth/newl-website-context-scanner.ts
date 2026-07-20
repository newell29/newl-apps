import { access, readFile } from "node:fs/promises";
import path from "node:path";

import { newlWebsiteContext, type NewlWebsiteContext } from "@/modules/website-growth/newl-website-context";

const TEMPLATE_FILES = [
  "components/templates/ServicePageTemplate.tsx",
  "components/templates/IndustryPageTemplate.tsx",
  "components/templates/LocationPageTemplate.tsx"
];

const PAGE_DATA_FILES = [
  { file: "lib/pages/services.ts", type: "Service page", routePrefix: "/services" },
  { file: "lib/pages/freight.ts", type: "Freight page", routePrefix: "/freight" },
  { file: "lib/pages/industries.ts", type: "Industry page", routePrefix: "/industries" },
  { file: "lib/industries/pages.ts", type: "Industry page", routePrefix: "/industries" },
  { file: "lib/pages/locations.ts", type: "Location page", routePrefix: "/locations" }
];

const KNOWN_COMPONENTS = [
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
];

export async function resolveNewlWebsiteContext(): Promise<NewlWebsiteContext> {
  const repoPath = await findNewlWebsiteRepoPath();

  if (!repoPath) {
    return newlWebsiteContext;
  }

  try {
    return await scanNewlWebsiteRepo(repoPath);
  } catch {
    return newlWebsiteContext;
  }
}

export async function scanNewlWebsiteRepo(repoPath: string): Promise<NewlWebsiteContext> {
  const files = await Promise.all(
    [...TEMPLATE_FILES, ...PAGE_DATA_FILES.map((entry) => entry.file)].map(async (file) => ({
      file,
      text: await readOptionalFile(path.join(repoPath, file))
    }))
  );
  const fileMap = new Map(files.map((file) => [file.file, file.text]));
  const routes = PAGE_DATA_FILES.flatMap((entry) => {
    const text = fileMap.get(entry.file) ?? "";
    return extractSlugs(text).map((slug) => ({ path: `${entry.routePrefix}/${slug}`, type: entry.type }));
  });
  const templates = TEMPLATE_FILES.map((file) => ({
    file,
    components: extractComponents(fileMap.get(file) ?? "")
  })).filter((template) => template.components.length > 0);
  const pageDataText = PAGE_DATA_FILES.map((entry) => fileMap.get(entry.file) ?? "").join("\n");
  const contactFormFields = unique(extractLabelValues(pageDataText));
  const internalLinks = unique(extractInternalLinks(pageDataText)).slice(0, 80);
  const faqSignals = PAGE_DATA_FILES.map((entry) => ({
    file: entry.file,
    count: countFaqSignals(fileMap.get(entry.file) ?? "")
  })).filter((entry) => entry.count > 0);

  return {
    ...newlWebsiteContext,
    reusableComponents: unique([
      ...newlWebsiteContext.reusableComponents,
      ...templates.flatMap((template) => template.components)
    ]),
    visualSystem: [
      ...newlWebsiteContext.visualSystem,
      "Before generating a draft, use the current site inventory to match existing page routes, templates, FAQ patterns, and form field conventions."
    ],
    seoRules: [
      ...newlWebsiteContext.seoRules,
      "Check the scanned site inventory before recommending a new URL; if an existing route already serves the intent, propose an update instead."
    ],
    siteInventory: {
      source: "repo-scan",
      scannedAt: new Date().toISOString(),
      repoPath,
      routes: uniqueRoutes(routes).slice(0, 200),
      templates,
      contactFormFields,
      faqSignals,
      internalLinks
    }
  };
}

async function findNewlWebsiteRepoPath() {
  const candidates = [
    process.env.NEWL_WEBSITE_REPO_PATH,
    path.resolve(process.cwd(), "../.."),
    path.resolve(process.cwd(), "..")
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    if (await looksLikeNewlWebsiteRepo(candidate)) {
      return candidate;
    }
  }

  return null;
}

async function looksLikeNewlWebsiteRepo(repoPath: string) {
  try {
    await access(path.join(repoPath, "components/templates/ServicePageTemplate.tsx"));
    await access(path.join(repoPath, "lib/pages/services.ts"));
    return true;
  } catch {
    return false;
  }
}

async function readOptionalFile(filePath: string) {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return "";
  }
}

function extractSlugs(text: string) {
  return unique([...text.matchAll(/slug:\s*["']([^"']+)["']/g)].map((match) => match[1]).filter(Boolean));
}

function extractComponents(text: string) {
  return KNOWN_COMPONENTS.filter((component) => text.includes(`<${component}`) || text.includes(`${component}(`));
}

function extractLabelValues(text: string) {
  return [...text.matchAll(/label:\s*["']([^"']+)["']/g)].map((match) => match[1]).filter(Boolean);
}

function extractInternalLinks(text: string) {
  return [...text.matchAll(/href:\s*["'](\/[^"']+)["']/g)].map((match) => match[1]).filter(Boolean);
}

function countFaqSignals(text: string) {
  return (text.match(/\bq:\s*["'`]/g) ?? []).length + (text.match(/\bquestion:\s*["'`]/g) ?? []).length;
}

function unique(values: string[]) {
  return [...new Set(values)];
}

function uniqueRoutes(routes: Array<{ path: string; type: string }>) {
  const seen = new Set<string>();
  return routes.filter((route) => {
    const key = `${route.type}:${route.path}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}
