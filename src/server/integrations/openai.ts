import { HunterServiceLine, OutreachChannel } from "@prisma/client";
import { normalizeCompanyName } from "@/server/integrations/apollo";
import type { HunterOutreachDirective } from "@/modules/lead-gen/hunter-outreach-eligibility";
import {
  type GeneratedOutreachSequence,
  type HunterContactFitReview,
  type ModelOutreachQaResult,
  type OutreachEvidenceRecord,
  type OutreachStrategy,
  type OutreachQaIssue
} from "@/modules/lead-gen/outreach-plan";

type Tier1DraftContext = {
  model: string;
  companyName: string;
  contactFirstName: string | null;
  contactFullName: string;
  contactTitle: string | null;
  contactDepartment: string | null;
  contactSeniority: string | null;
  selectedSequenceName: string | null;
  shipmentCount: number;
  latestShipmentDate: string | null;
  arrivalPort: string | null;
  destinationCity: string | null;
  destinationState: string | null;
  destinationMarket: string | null;
  originCountry: string | null;
  originPort: string | null;
  foreignPort: string | null;
  shipFromPort: string | null;
  placeOfReceipt: string | null;
  productDescription: string | null;
  hsCode: string | null;
  totalTeu: number;
  carrier: string | null;
  vessel: string | null;
  voyage: string | null;
  searchProfileName: string | null;
  profileDestinationMarkets: string[];
  profileProductKeywords: string[];
  recurringOrigins: string[];
  recurringDestinationPorts: string[];
  recurringCarriers: string[];
  recurringProducts: string[];
  recentShipmentHighlights: string[];
};

type Tier1DraftResult = {
  subject: string;
  body: string;
  personalizationNotes: string;
  rawResponse: Record<string, unknown>;
};

export type OutreachStrategyGenerationContext = {
  model: string;
  companyName: string;
  companyDomain: string | null;
  contact: {
    firstName: string | null;
    fullName: string;
    title: string | null;
    department: string | null;
    seniority: string | null;
  };
  selectedSequenceName: string;
  recommendedPersona: string | null;
  recommendedCadence: string | null;
  hunterDirective: HunterOutreachDirective;
  senderFirstName?: string;
  allowCallTask?: boolean;
  evidence: OutreachEvidenceRecord[];
  reviewerFeedback: string | null;
};

export type OutreachSequenceGenerationContext = {
  model: string;
  companyName: string;
  contact: OutreachStrategyGenerationContext["contact"];
  selectedSequenceName: string;
  strategy: OutreachStrategy;
  senderFirstName?: string;
  evidence: OutreachEvidenceRecord[];
  allowCallTask: boolean;
  reviewerFeedback: string | null;
};

export type OutreachSequenceQaContext = {
  model: string;
  companyName: string;
  contact: OutreachStrategyGenerationContext["contact"];
  strategy: OutreachStrategy;
  sequence: GeneratedOutreachSequence;
  evidence: OutreachEvidenceRecord[];
  senderFirstName?: string;
  allowCallTask?: boolean;
};

export type HunterContactFitReviewContext = {
  model: string;
  company: {
    name: string;
    domain: string | null;
  };
  opportunity: {
    serviceLine: HunterServiceLine;
    opportunityType: string;
    rationale: string;
    recommendedPersona: string | null;
  };
  contacts: Array<{
    contactId: string;
    fullName: string;
    title: string | null;
    department: string | null;
    seniority: string | null;
    hasEmail: boolean;
    hasPhone: boolean;
    hasLinkedin: boolean;
    city: string | null;
    state: string | null;
    country: string | null;
    sequenceStatus: string;
    replyStatus: string;
    existingSequenceName: string | null;
    lastTouchAt: string | null;
    lastReplyAt: string | null;
    priorActivityStatus: string | null;
  }>;
};

export type OpenAiStructuredUsage = {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  totalTokens: number;
};

export type WebsiteGrowthDraftContext = {
  model: string;
  reasoningEffort: "low" | "medium" | "high" | "xhigh";
  opportunity: {
    action: string;
    topic: string;
    primaryKeyword: string | null;
    targetPage: string | null;
    sourcePage: string | null;
    score: number;
    confidence: string | null;
    reason: string;
    recommendation: string;
    supportingKeywords: string[];
    evidence: Record<string, unknown>;
  };
  websiteContext: Record<string, unknown>;
  pagePattern: Record<string, unknown>;
};

export type WebsiteGrowthDraftResult = {
  title: string;
  summary: string;
  contentType: string;
  proposedPath: string | null;
  targetKeyword: string;
  searchIntent: string;
  sections: Array<{
    heading: string;
    purpose: string;
    draftCopy: string;
  }>;
  metaTitle: string;
  metaDescription: string;
  faqs: Array<{
    question: string;
    answer: string;
  }>;
  internalLinks: Array<{
    label: string;
    url: string;
    reason: string;
  }>;
  implementationNotes: string[];
  reviewChecklist: string[];
  websitePageType: string;
  websiteTemplate: string;
  layoutComponents: string[];
  designSystemNotes: string[];
  pagePreview: WebsiteGrowthDraftPagePreview | null;
  rawResponse: Record<string, unknown>;
};

export type WebsiteGrowthDraftPagePreview = {
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

export type ApolloCompanySuggestionContext = {
  model: string;
  companyName: string;
  companyDomain: string | null;
  latestMatchClassification: string | null;
  latestMatchReason: string | null;
  recurringOrigins: string[];
  recurringDestinationPorts: string[];
  recurringProducts: string[];
  recentShipmentHighlights: string[];
};

export type ApolloCompanySuggestionResult = {
  suggestedCompanyName: string;
  confidence: "LOW" | "MEDIUM" | "HIGH";
  rationale: string;
  source: "ai" | "heuristic";
  rawResponse: Record<string, unknown> | null;
};

const OPENAI_API_BASE_URL = "https://api.openai.com/v1";

const OUTREACH_STRATEGY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "serviceLine",
    "opportunityType",
    "objective",
    "triggerSummary",
    "buyerHypothesis",
    "valueProposition",
    "likelyObjection",
    "callToAction",
    "channelStrategy",
    "senderRecommendation",
    "confidence",
    "evidenceRefs"
  ],
  properties: {
    serviceLine: {
      type: "string",
      enum: ["WAREHOUSING", "OCEAN_AIR", "TRUCKING"]
    },
    opportunityType: { type: "string", minLength: 2, maxLength: 120 },
    objective: { type: "string", minLength: 2, maxLength: 300 },
    triggerSummary: { type: "string", minLength: 2, maxLength: 500 },
    buyerHypothesis: { type: "string", minLength: 2, maxLength: 500 },
    valueProposition: { type: "string", minLength: 2, maxLength: 500 },
    likelyObjection: { type: "string", minLength: 2, maxLength: 300 },
    callToAction: { type: "string", minLength: 2, maxLength: 240 },
    channelStrategy: {
      type: "array",
      minItems: 1,
      maxItems: 6,
      items: { type: "string", minLength: 2, maxLength: 240 }
    },
    senderRecommendation: { type: "string", minLength: 2, maxLength: 160 },
    confidence: { type: "integer", minimum: 0, maximum: 100 },
    evidenceRefs: {
      type: "array",
      minItems: 1,
      maxItems: 12,
      items: { type: "string", minLength: 1, maxLength: 120 }
    }
  }
} as const;

const HUNTER_CONTACT_FIT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["reviews"],
  properties: {
    reviews: {
      type: "array",
      minItems: 1,
      maxItems: 10,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "contactId",
          "disposition",
          "confidence",
          "responsibilityHypothesis",
          "rationale",
          "recommendedApproach",
          "riskFlags"
        ],
        properties: {
          contactId: { type: "string", minLength: 1, maxLength: 100 },
          disposition: {
            type: "string",
            enum: ["PRIMARY", "SECONDARY", "REVIEW", "REJECT"]
          },
          confidence: { type: "integer", minimum: 0, maximum: 100 },
          responsibilityHypothesis: { type: "string", minLength: 2, maxLength: 400 },
          rationale: { type: "string", minLength: 2, maxLength: 500 },
          recommendedApproach: { type: "string", minLength: 2, maxLength: 300 },
          riskFlags: {
            type: "array",
            maxItems: 8,
            items: { type: "string", minLength: 2, maxLength: 160 }
          }
        }
      }
    }
  }
} as const;

const OUTREACH_SEQUENCE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["sequenceName", "steps"],
  properties: {
    sequenceName: { type: "string", minLength: 2, maxLength: 160 },
    steps: {
      type: "array",
      minItems: 3,
      maxItems: 4,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["stepNumber", "channel", "delayDays", "subject", "body", "angle", "evidenceRefs"],
        properties: {
          stepNumber: { type: "integer", minimum: 1, maximum: 4 },
          channel: {
            type: "string",
            enum: ["EMAIL", "LINKEDIN_TASK", "CALL_TASK"]
          },
          delayDays: { type: "integer", minimum: 0, maximum: 30 },
          subject: {
            type: ["string", "null"],
            maxLength: 80
          },
          body: { type: "string", minLength: 20, maxLength: 900 },
          angle: { type: "string", minLength: 2, maxLength: 240 },
          evidenceRefs: {
            type: "array",
            minItems: 1,
            maxItems: 8,
            items: { type: "string", minLength: 1, maxLength: 120 }
          }
        }
      }
    }
  }
} as const;

const OUTREACH_QA_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["passed", "issues"],
  properties: {
    passed: { type: "boolean" },
    issues: {
      type: "array",
      maxItems: 30,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["code", "severity", "message", "stepNumber"],
        properties: {
          code: { type: "string", minLength: 2, maxLength: 80 },
          severity: { type: "string", enum: ["ERROR", "WARNING"] },
          message: { type: "string", minLength: 2, maxLength: 500 },
          stepNumber: {
            type: ["integer", "null"],
            minimum: 1,
            maximum: 5
          }
        }
      }
    }
  }
} as const;

export function isOpenAiDraftGenerationConfigured() {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  return Boolean(apiKey && apiKey !== "OPENAI_API_KEY_PLACEHOLDER");
}

export function getOpenAiDraftRuntimeNotes() {
  return isOpenAiDraftGenerationConfigured()
    ? "OpenAI runtime is configured through the server environment."
    : "OpenAI runtime is not configured yet. Add OPENAI_API_KEY in the server environment to enable live draft generation.";
}

export async function generateTier1SequenceDraft(context: Tier1DraftContext): Promise<Tier1DraftResult> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();

  if (!apiKey || apiKey === "OPENAI_API_KEY_PLACEHOLDER") {
    throw new Error("OPENAI_API_KEY is not configured. Add it to enable live Tier 1 draft generation.");
  }

  const response = await fetch(`${OPENAI_API_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: context.model,
      temperature: 0.7,
      response_format: {
        type: "json_object"
      },
      messages: [
        {
          role: "system",
          content:
            "You write concise outbound logistics prospecting emails for Newl Group. Your goal is to earn a reply from a logistics decision-maker by sounding specific, commercially aware, and relevant to the contact's lane activity. Return JSON only with keys subject, body, personalizationNotes. Body must be plain text with short paragraphs separated by two newlines. Do not use markdown. Do not fabricate facts, shipment counts, ports, countries, carriers, products, or services beyond the provided context. Avoid hype, fake familiarity, and generic AI phrasing like 'I hope this email finds you well' or 'reaching out because'."
        },
        {
          role: "user",
          content: buildTier1DraftPrompt(context)
        }
      ]
    }),
    cache: "no-store"
  });

  const json = (await response.json().catch(() => null)) as Record<string, unknown> | null;

  if (!response.ok || !json) {
    throw new Error(extractOpenAiError(json) ?? `OpenAI draft generation failed with status ${response.status}.`);
  }

  const content = readAssistantContent(json);
  const parsed = parseDraftPayload(content);

  return {
    ...parsed,
    rawResponse: json
  };
}

export async function generateOutreachStrategy(
  context: OutreachStrategyGenerationContext
): Promise<{ strategy: OutreachStrategy; usage: OpenAiStructuredUsage }> {
  const response = await requestStructuredOpenAiResponse({
    model: context.model,
    reasoningEffort: "medium",
    schemaName: "newl_outreach_strategy",
    schema: OUTREACH_STRATEGY_SCHEMA,
    system:
      "You are Newl Group's B2B logistics outreach strategist. Build a concise, evidence-grounded plan for one specific buyer. Newl provides warehousing, ocean and air freight, port drayage, and trucking support. An internal research system has already ranked the opportunity and selected the required service line. Use hunterDirective.requiredServiceLine exactly; do not reconsider or substitute another service line. Use the directive's opportunity type and rationale as the point of attack, refining copy only where the supplied evidence supports it. Treat evidence IDs and internal system names as private metadata that must never appear in outbound copy. Set senderRecommendation to senderFirstName. When allowCallTask is true, channelStrategy must include one separate human day-7 call task alongside the three emails; when false it must be email-only and must not mention a call. Apply reviewerFeedback to tone, emphasis, phrasing, and approach when supplied, but never let feedback override evidence, the saved service line, contact identity, safety rules, or QA requirements. Do not invent company events, shipment facts, incumbent relationships, locations, volumes, capabilities, or contact responsibilities. Every factual strategy claim must cite one or more supplied evidence IDs.",
    user: JSON.stringify({
      company: {
        name: context.companyName,
        domain: context.companyDomain
      },
      contact: context.contact,
      selectedSequenceName: context.selectedSequenceName,
      recommendedPersona: context.recommendedPersona,
      recommendedCadence: context.recommendedCadence,
      hunterDirective: context.hunterDirective,
      senderFirstName: context.senderFirstName,
      allowCallTask: context.allowCallTask,
      reviewerFeedback: context.reviewerFeedback,
      evidenceLedger: context.evidence
    })
  });

  const strategy = parseOutreachStrategy(response.output);
  if (strategy.serviceLine !== context.hunterDirective.requiredServiceLine) {
    throw new Error(
      `OpenAI outreach strategy changed Hunter's required service line from ${context.hunterDirective.requiredServiceLine} to ${strategy.serviceLine}.`
    );
  }

  return {
    strategy,
    usage: response.usage
  };
}

export async function reviewHunterContactFit(
  context: HunterContactFitReviewContext
): Promise<{ reviews: HunterContactFitReview[]; usage: OpenAiStructuredUsage }> {
  const response = await requestStructuredOpenAiResponse({
    model: context.model,
    reasoningEffort: "low",
    schemaName: "newl_hunter_contact_fit",
    schema: HUNTER_CONTACT_FIT_SCHEMA,
    system:
      "You are the conservative buyer-role gate for Newl Group logistics outreach. Review the complete supplied candidate cohort and decide which 1-3 people are best aligned to the specific saved opportunity. Use only exact company identity, title, department, seniority, geography, contactability, prior sequence/reply history, the required service line, opportunity rationale, and recommended persona. Prefer people located at or responsible for the opportunity geography when that is supported. A contact clearly based outside the opportunity geography without a global, North American, Americas, U.S., or otherwise relevant remit must be REVIEW or REJECT and must include the exact risk flag GEOGRAPHY_MISMATCH. PRIMARY means likely owns or materially influences the decision. SECONDARY means a credible adjacent stakeholder or route to the owner. REVIEW means the role is uncertain and must not receive automatic outreach. REJECT means clearly irrelevant, too junior, seller-side, unrelated, already replied, or inappropriate to re-contact. Treat UNRESPONSIVE and prior sequence activity as meaningful risk: prefer a fresh relevant stakeholder, but do not claim the person is permanently invalid solely because an old sequence finished. Never infer responsibilities merely from seniority. Generic digital, franchise, revenue, people, finance, clinical, sales, marketing, customer-service, or administrative operations roles are not physical logistics buyers. Do not promote those roles unless the opportunity specifically makes that function relevant. Return exactly one review for every supplied contactId and do not invent IDs.",
    user: JSON.stringify({
      company: context.company,
      opportunity: context.opportunity,
      contacts: context.contacts
    })
  });

  return {
    reviews: parseHunterContactFitReviews(response.output),
    usage: response.usage
  };
}

export async function generateCompleteOutreachSequence(
  context: OutreachSequenceGenerationContext
): Promise<{ sequence: GeneratedOutreachSequence; usage: OpenAiStructuredUsage }> {
  const response = await requestStructuredOpenAiResponse({
    model: context.model,
    reasoningEffort: "low",
    schemaName: "newl_outreach_sequence",
    schema: OUTREACH_SEQUENCE_SCHEMA,
    system:
      "You write concise, credible B2B logistics outreach for Newl Group. Return three coordinated EMAIL touches on days 0, 4, and 10. If allowCallTask is true, also return one CALL_TASK on day 7; otherwise return no call task. Never return a LinkedIn task. For the Hunter - Executive Referral cadence, write respectfully to a senior stakeholder and make it easy to refer Newl to the operating owner; do not presume the executive owns the work. For Hunter - Email Only, address the likely operational buyer directly. Each email must advance a different angle and aim for a low-friction reply. End every email body with senderFirstName on its own final line. Never use a sender placeholder, a generic company signature, the word Hunter, an evidence ID, or any internal system/research reference in the subject or body. Evidence IDs belong only in evidenceRefs. A call task must be an instruction for a person, never a claim that a call occurred. Use only the supplied evidence and strategy. Do not fabricate facts. Every step must cite at least one supplied evidence ID. Plain text only; no markdown, HTML, hype, fake familiarity, or generic AI phrasing.",
    user: JSON.stringify({
      companyName: context.companyName,
      contact: context.contact,
      selectedSequenceName: context.selectedSequenceName,
      allowCallTask: context.allowCallTask,
      senderFirstName: context.senderFirstName,
      reviewerFeedback: context.reviewerFeedback,
      strategy: context.strategy,
      evidenceLedger: context.evidence
    })
  });

  return {
    sequence: parseOutreachSequence(response.output),
    usage: response.usage
  };
}

export async function reviewOutreachSequenceGrounding(
  context: OutreachSequenceQaContext
): Promise<{ result: ModelOutreachQaResult; usage: OpenAiStructuredUsage }> {
  const response = await requestStructuredOpenAiResponse({
    model: context.model,
    reasoningEffort: "low",
    schemaName: "newl_outreach_qa",
    schema: OUTREACH_QA_SCHEMA,
    system:
      "You are the conservative QA gate for Newl Group outbound logistics messaging. Compare every factual claim with the saved evidence ledger. Fail unsupported events, shipment claims, quantities, geography, buyer responsibilities, incumbent-provider assumptions, Newl capabilities not listed in the strategy context, deceptive familiarity, or messages that imply a LinkedIn/call action already happened. Also fail any outbound use of the word Hunter, any internal evidence ID or research-system reference, any sender placeholder or generic Newl Group signature, any email that does not end with senderFirstName on its own final line, and any mismatch between allowCallTask and the sequence or channel strategy. Style preferences alone are warnings. Return passed=false whenever any ERROR exists.",
    user: JSON.stringify({
      companyName: context.companyName,
      contact: context.contact,
      strategy: context.strategy,
      sequence: context.sequence,
      senderFirstName: context.senderFirstName,
      allowCallTask: context.allowCallTask,
      evidenceLedger: context.evidence
    })
  });

  return {
    result: parseOutreachQaResult(response.output),
    usage: response.usage
  };
}

export async function generateWebsiteGrowthContentDraft(
  context: WebsiteGrowthDraftContext
): Promise<WebsiteGrowthDraftResult> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();

  if (!apiKey || apiKey === "OPENAI_API_KEY_PLACEHOLDER") {
    throw new Error("OPENAI_API_KEY is not configured. Add it to enable live Website Growth draft generation.");
  }

  const response = await fetch(`${OPENAI_API_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: context.model,
      reasoning_effort: context.reasoningEffort,
      response_format: {
        type: "json_object"
      },
      messages: [
        {
          role: "system",
          content:
            "You are a B2B logistics SEO strategist and senior web producer for Newl Group. Generate implementation-ready SEO content that can be reviewed visually before publication. Return JSON only with keys title, summary, contentType, proposedPath, targetKeyword, searchIntent, sections, metaTitle, metaDescription, faqs, internalLinks, implementationNotes, reviewChecklist, websitePageType, websiteTemplate, layoutComponents, designSystemNotes, pagePreview. pagePreview must be a visitor-facing Newl website page experience, not a proposal, not instructions, and not a checklist. For a new page or legacy redirect rebuild, pagePreview should show the complete proposed page. For an existing page improvement, pagePreview should show how the improved page should read after the change. Do not use words like proposal, draft, approve, implementation, or should inside pagePreview copy. Do not fabricate customer names, certifications, carrier relationships, locations, or metrics beyond the supplied opportunity. Match the supplied Newl website pattern, component sequence, tone, CTAs, FAQ style, and internal linking behavior."
        },
        {
          role: "user",
          content: buildWebsiteGrowthDraftPrompt(context)
        }
      ]
    }),
    cache: "no-store"
  });

  const json = (await response.json().catch(() => null)) as Record<string, unknown> | null;

  if (!response.ok || !json) {
    throw new Error(extractOpenAiError(json) ?? `OpenAI Website Growth draft generation failed with status ${response.status}.`);
  }

  const content = readAssistantContent(json);
  const parsed = parseWebsiteGrowthDraftPayload(content);

  return {
    ...parsed,
    rawResponse: json
  };
}

export async function generateApolloCompanyNameSuggestion(
  context: ApolloCompanySuggestionContext
): Promise<ApolloCompanySuggestionResult> {
  if (!isOpenAiDraftGenerationConfigured()) {
    return buildHeuristicApolloCompanySuggestion(context);
  }

  const apiKey = process.env.OPENAI_API_KEY?.trim();

  if (!apiKey || apiKey === "OPENAI_API_KEY_PLACEHOLDER") {
    return buildHeuristicApolloCompanySuggestion(context);
  }

  const response = await fetch(`${OPENAI_API_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: context.model,
      temperature: 0.2,
      response_format: {
        type: "json_object"
      },
      messages: [
        {
          role: "system",
          content:
            "You normalize company names for Apollo company matching in a B2B logistics workflow. Return JSON only with keys suggestedCompanyName, confidence, rationale. Suggest the most likely operating company name to search in Apollo, not a branch label, port note, shipment descriptor, or legal suffix-heavy variant. Keep the suggestion concise and do not invent parent companies unless clearly implied."
        },
        {
          role: "user",
          content: buildApolloCompanySuggestionPrompt(context)
        }
      ]
    }),
    cache: "no-store"
  });

  const json = (await response.json().catch(() => null)) as Record<string, unknown> | null;

  if (!response.ok || !json) {
    return buildHeuristicApolloCompanySuggestion(context);
  }

  const content = readAssistantContent(json);
  const parsed = parseApolloCompanySuggestionPayload(content);

  return {
    ...parsed,
    source: "ai",
    rawResponse: json
  };
}

function buildWebsiteGrowthDraftPrompt(context: WebsiteGrowthDraftContext) {
  return JSON.stringify(
    {
      objective:
        "Generate a review-ready Website Growth draft with two layers: a visitor-facing pagePreview that renders like a Newl website page, and implementation/review metadata for the app. It may be a new page, an existing page improvement, a resource article, a page section, an internal linking plan, or a redirect/content mapping plan.",
      newlPositioning: [
        "Newl is a warehousing-led logistics partner.",
        "Core strengths include warehousing, fulfillment, Amazon FBA support, B2B wholesale and retail fulfillment, cross-docking, Teamship WMS visibility, GTA local trucking, ground distribution, cross-border logistics, ocean freight, and air freight.",
        "Newl has Mississauga and Charlotte warehouse hubs and can coordinate trusted partner warehouse coverage across Canada and the U.S.",
        "The content should drive practical inbound conversations, not generic blog traffic."
      ],
      writingRules: [
        "Keep the recommendation specific to the opportunity.",
        "Do not say a page is published or live.",
        "If an existing target page is supplied, propose improvements to that page instead of inventing a duplicate URL.",
        "Follow the supplied Newl page pattern and component sequence. The draft should feel like it belongs in the existing Newl website, not as a generic SEO page.",
        "The pagePreview must be real visitor-facing page copy in Newl website style, not task instructions.",
        "For a new page or legacy redirect rebuild, produce a complete pagePreview for the proposed URL.",
        "For an existing page improvement, produce the pagePreview as the page would read after the recommended change.",
        "Do not use words like proposal, draft, approve, implementation, checklist, or should inside pagePreview.",
        "Use the websiteContext and selectedPagePattern to mirror Newl hero, proof card, section, FAQ, internal link, and CTA patterns.",
        "Reference existing page components by name when giving implementation notes.",
        "Use FAQs and internal links to support conversion and topical authority.",
        "Do not introduce numerical performance, comparative, guarantee, certification, affiliation, or customer-proof claims unless the supplied evidence contains the exact claim and source.",
        "Prefer concrete capability language over superlatives or promises.",
        "Include a review checklist for a human approver before anything is posted."
      ],
      websiteContext: context.websiteContext,
      selectedPagePattern: context.pagePattern,
      opportunity: context.opportunity
    },
    null,
    2
  );
}

function buildTier1DraftPrompt(context: Tier1DraftContext) {
  return JSON.stringify(
    {
      objective:
        "Generate a Newl Group Tier 1 outbound draft for a logistics decision-maker using the provided TradeMining shipment context.",
      rules: [
        "Subject should feel specific, not generic, and should not mention TradeMining, data providers, or monitoring.",
        "Use the contact first name if available.",
        "Anchor the opener in the most concrete shipment signal available: destination market, arrival port, origin country, recurring lane, product type, or cadence.",
        "Only mention details that are explicitly present in the context.",
        "Frame Newl Group around practical support such as port drayage, transloading, warehousing, final-mile delivery, or ongoing freight support when those services logically fit the lane described.",
        "Keep the body to 3 short paragraphs plus a brief closing question.",
        "Write for reply conversion: crisp, observant, low-friction, and commercially useful.",
        "Avoid sounding like surveillance. Do not say 'I saw all your shipments' or similar.",
        "Do not invent lanes, volumes, operational pain points, or claims about current providers."
      ],
      writingPreferences: {
        tone: "confident, concise, practical",
        cta: "single low-friction question that invites a reply",
        avoid: [
          "marketing fluff",
          "long intros",
          "claims that Newl already knows their exact problems",
          "generic statements that could fit any importer"
        ]
      },
      context
    },
    null,
    2
  );
}

function buildApolloCompanySuggestionPrompt(context: ApolloCompanySuggestionContext) {
  return JSON.stringify(
    {
      objective: "Suggest the best Apollo company-search name for a company that failed or produced a low-confidence Apollo match.",
      rules: [
        "Prefer the likely operating company name someone would use on LinkedIn or Apollo.",
        "Remove legal suffix noise when it does not help the search.",
        "Do not output a branch/location label unless the branch label appears central to the company identity.",
        "Do not suggest a freight forwarder, carrier, warehouse operator, or other logistics intermediary unless the evidence strongly indicates that is the actual target company.",
        "Use shipment evidence only as context for plausibility, not as text to copy into the company name."
      ],
      context
    },
    null,
    2
  );
}

function readAssistantContent(payload: Record<string, unknown>) {
  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  const message = choices[0] && typeof choices[0] === "object" ? (choices[0] as Record<string, unknown>).message : null;
  const content = message && typeof message === "object" ? (message as Record<string, unknown>).content : null;

  if (typeof content !== "string" || content.trim().length === 0) {
    throw new Error("OpenAI returned an empty draft response.");
  }

  return content;
}

function parseWebsiteGrowthDraftPayload(content: string) {
  let parsed: Record<string, unknown>;

  try {
    parsed = JSON.parse(content) as Record<string, unknown>;
  } catch {
    throw new Error("OpenAI returned a Website Growth draft response that was not valid JSON.");
  }

  const title = readNonEmptyString(parsed.title);
  const summary = readNonEmptyString(parsed.summary);
  const contentType = readNonEmptyString(parsed.contentType);
  const targetKeyword = readNonEmptyString(parsed.targetKeyword);
  const searchIntent = readNonEmptyString(parsed.searchIntent);
  const metaTitle = readNonEmptyString(parsed.metaTitle);
  const metaDescription = readNonEmptyString(parsed.metaDescription);
  const proposedPath = typeof parsed.proposedPath === "string" && parsed.proposedPath.trim().length > 0
    ? parsed.proposedPath.trim()
    : null;
  const sections = readObjectArray(parsed.sections)
    .map((section) => ({
      heading: readNonEmptyString(section.heading) ?? "",
      purpose: readNonEmptyString(section.purpose) ?? "",
      draftCopy: readNonEmptyString(section.draftCopy) ?? ""
    }))
    .filter((section) => section.heading && section.purpose && section.draftCopy);
  const faqs = readObjectArray(parsed.faqs)
    .map((faq) => ({
      question: readNonEmptyString(faq.question) ?? "",
      answer: readNonEmptyString(faq.answer) ?? ""
    }))
    .filter((faq) => faq.question && faq.answer);
  const internalLinks = readObjectArray(parsed.internalLinks)
    .map((link) => ({
      label: readNonEmptyString(link.label) ?? "",
      url: readNonEmptyString(link.url) ?? "",
      reason: readNonEmptyString(link.reason) ?? ""
    }))
    .filter((link) => link.label && link.url && link.reason);
  const implementationNotes = readStringArray(parsed.implementationNotes);
  const reviewChecklist = readStringArray(parsed.reviewChecklist);
  const websitePageType = readNonEmptyString(parsed.websitePageType);
  const websiteTemplate = readNonEmptyString(parsed.websiteTemplate);
  const layoutComponents = readStringArray(parsed.layoutComponents);
  const designSystemNotes = readStringArray(parsed.designSystemNotes);
  const pagePreview = readWebsiteGrowthPagePreview(parsed.pagePreview);

  if (!title || !summary || !contentType || !targetKeyword || !searchIntent || !metaTitle || !metaDescription || !websitePageType || !websiteTemplate) {
    throw new Error("OpenAI returned an incomplete Website Growth draft payload.");
  }

  if (sections.length === 0 || implementationNotes.length === 0 || reviewChecklist.length === 0 || layoutComponents.length === 0 || designSystemNotes.length === 0) {
    throw new Error("OpenAI returned a Website Growth draft without enough implementation detail.");
  }

  return {
    title,
    summary,
    contentType,
    proposedPath,
    targetKeyword,
    searchIntent,
    sections,
    metaTitle,
    metaDescription,
    faqs,
    internalLinks,
    implementationNotes,
    reviewChecklist,
    websitePageType,
    websiteTemplate,
    layoutComponents,
    designSystemNotes,
    pagePreview
  };
}

function readWebsiteGrowthPagePreview(value: unknown): WebsiteGrowthDraftPagePreview | null {
  const record = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

  if (!record) {
    return null;
  }

  const heroTitle = readNonEmptyString(record.heroTitle);
  const heroCopy = readNonEmptyString(record.heroCopy);
  const sections = readObjectArray(record.sections)
    .map((section) => ({
      eyebrow: readNonEmptyString(section.eyebrow) ?? "NEED TO KNOW",
      heading: readNonEmptyString(section.heading) ?? "",
      body: readNonEmptyString(section.body) ?? "",
      cards: readObjectArray(section.cards)
        .map((card) => ({
          title: readNonEmptyString(card.title) ?? "",
          body: readNonEmptyString(card.body) ?? ""
        }))
        .filter((card) => card.title && card.body)
        .slice(0, 6)
    }))
    .filter((section) => section.heading && section.body)
    .slice(0, 8);

  if (!heroTitle || !heroCopy || sections.length === 0) {
    return null;
  }

  const finalCta = value && typeof record.finalCta === "object" && !Array.isArray(record.finalCta)
    ? (record.finalCta as Record<string, unknown>)
    : {};

  return {
    mode: readPreviewMode(record.mode),
    eyebrow: readNonEmptyString(record.eyebrow) ?? "WAREHOUSE-LED LOGISTICS",
    heroTitle,
    heroCopy,
    heroBullets: readStringArray(record.heroBullets).slice(0, 6),
    primaryCta: readNonEmptyString(record.primaryCta) ?? "Request Logistics Review",
    secondaryCta: readNonEmptyString(record.secondaryCta) ?? "Talk to Newl",
    proofCards: readObjectArray(record.proofCards)
      .map((card) => ({
        label: readNonEmptyString(card.label) ?? "",
        value: readNonEmptyString(card.value) ?? "",
        body: readNonEmptyString(card.body) ?? ""
      }))
      .filter((card) => card.label && card.value && card.body)
      .slice(0, 6),
    sections,
    faqs: readObjectArray(record.faqs)
      .map((faq) => ({
        question: readNonEmptyString(faq.question) ?? "",
        answer: readNonEmptyString(faq.answer) ?? ""
      }))
      .filter((faq) => faq.question && faq.answer)
      .slice(0, 8),
    internalLinks: readObjectArray(record.internalLinks)
      .map((link) => ({
        label: readNonEmptyString(link.label) ?? "",
        url: readNonEmptyString(link.url) ?? "",
        reason: readNonEmptyString(link.reason) ?? ""
      }))
      .filter((link) => link.label && link.url && link.reason)
      .slice(0, 8),
    finalCta: {
      heading: readNonEmptyString(finalCta.heading) ?? "Talk to Newl about the right logistics setup.",
      body: readNonEmptyString(finalCta.body) ?? "Share your inventory, service, and freight requirements and Newl will review the best operating path.",
      buttonLabel: readNonEmptyString(finalCta.buttonLabel) ?? "Request Logistics Review"
    }
  };
}

function readPreviewMode(value: unknown): WebsiteGrowthDraftPagePreview["mode"] {
  const allowed: WebsiteGrowthDraftPagePreview["mode"][] = [
    "new_page",
    "existing_page_update",
    "legacy_redirect_rebuild",
    "internal_link_update"
  ];

  return typeof value === "string" && allowed.includes(value as WebsiteGrowthDraftPagePreview["mode"])
    ? (value as WebsiteGrowthDraftPagePreview["mode"])
    : "new_page";
}

function parseDraftPayload(content: string) {
  let parsed: Record<string, unknown>;

  try {
    parsed = JSON.parse(content) as Record<string, unknown>;
  } catch {
    throw new Error("OpenAI returned a draft response that was not valid JSON.");
  }

  const subject = readNonEmptyString(parsed.subject);
  const body = readNonEmptyString(parsed.body);
  const personalizationNotes = readNonEmptyString(parsed.personalizationNotes);

  if (!subject || !body || !personalizationNotes) {
    throw new Error("OpenAI returned an incomplete draft payload.");
  }

  return {
    subject,
    body,
    personalizationNotes
  };
}

async function requestStructuredOpenAiResponse({
  model,
  reasoningEffort,
  schemaName,
  schema,
  system,
  user
}: {
  model: string;
  reasoningEffort: "low" | "medium";
  schemaName: string;
  schema: Record<string, unknown>;
  system: string;
  user: string;
}) {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey || apiKey === "OPENAI_API_KEY_PLACEHOLDER") {
    throw new Error("OPENAI_API_KEY is not configured. Add it to enable outreach generation.");
  }

  const response = await fetch(`${OPENAI_API_BASE_URL}/responses`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      reasoning: {
        effort: reasoningEffort
      },
      input: [
        {
          role: "system",
          content: system
        },
        {
          role: "user",
          content: user
        }
      ],
      text: {
        format: {
          type: "json_schema",
          name: schemaName,
          strict: true,
          schema
        }
      }
    }),
    cache: "no-store"
  });

  const json = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok || !json) {
    throw new Error(extractOpenAiError(json) ?? `OpenAI outreach generation failed with status ${response.status}.`);
  }

  const content = readResponsesOutputText(json);
  try {
    return {
      output: JSON.parse(content) as Record<string, unknown>,
      usage: readStructuredUsage(json)
    };
  } catch {
    throw new Error("OpenAI returned outreach output that was not valid JSON.");
  }
}

function readStructuredUsage(payload: Record<string, unknown>): OpenAiStructuredUsage {
  const usage =
    payload.usage && typeof payload.usage === "object" && !Array.isArray(payload.usage)
      ? (payload.usage as Record<string, unknown>)
      : {};
  const inputDetails =
    usage.input_tokens_details &&
    typeof usage.input_tokens_details === "object" &&
    !Array.isArray(usage.input_tokens_details)
      ? (usage.input_tokens_details as Record<string, unknown>)
      : {};
  const inputTokens = readNonNegativeInteger(usage.input_tokens);
  const outputTokens = readNonNegativeInteger(usage.output_tokens);
  return {
    inputTokens,
    outputTokens,
    cachedInputTokens: readNonNegativeInteger(inputDetails.cached_tokens),
    totalTokens: readNonNegativeInteger(usage.total_tokens) || inputTokens + outputTokens
  };
}

function readNonNegativeInteger(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : 0;
}

function readResponsesOutputText(payload: Record<string, unknown>) {
  if (typeof payload.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text.trim();
  }

  const output = Array.isArray(payload.output) ? payload.output : [];
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const content = Array.isArray((item as Record<string, unknown>).content)
      ? ((item as Record<string, unknown>).content as unknown[])
      : [];
    for (const part of content) {
      if (!part || typeof part !== "object") continue;
      const text = (part as Record<string, unknown>).text;
      if (typeof text === "string" && text.trim()) {
        return text.trim();
      }
    }
  }

  throw new Error("OpenAI returned no structured outreach output.");
}

function parseOutreachStrategy(parsed: Record<string, unknown>): OutreachStrategy {
  const serviceLine = readEnumValue(parsed.serviceLine, Object.values(HunterServiceLine));
  const opportunityType = readNonEmptyString(parsed.opportunityType);
  const objective = readNonEmptyString(parsed.objective);
  const triggerSummary = readNonEmptyString(parsed.triggerSummary);
  const buyerHypothesis = readNonEmptyString(parsed.buyerHypothesis);
  const valueProposition = readNonEmptyString(parsed.valueProposition);
  const likelyObjection = readNonEmptyString(parsed.likelyObjection);
  const callToAction = readNonEmptyString(parsed.callToAction);
  const channelStrategy = readStringArray(parsed.channelStrategy);
  const senderRecommendation = readNonEmptyString(parsed.senderRecommendation);
  const confidence =
    typeof parsed.confidence === "number" && Number.isInteger(parsed.confidence)
      ? parsed.confidence
      : null;
  const evidenceRefs = readStringArray(parsed.evidenceRefs);

  if (
    !serviceLine ||
    !opportunityType ||
    !objective ||
    !triggerSummary ||
    !buyerHypothesis ||
    !valueProposition ||
    !likelyObjection ||
    !callToAction ||
    channelStrategy.length === 0 ||
    !senderRecommendation ||
    confidence === null ||
    confidence < 0 ||
    confidence > 100 ||
    evidenceRefs.length === 0
  ) {
    throw new Error("OpenAI returned an incomplete outreach strategy.");
  }

  return {
    serviceLine,
    opportunityType,
    objective,
    triggerSummary,
    buyerHypothesis,
    valueProposition,
    likelyObjection,
    callToAction,
    channelStrategy,
    senderRecommendation,
    confidence,
    evidenceRefs
  };
}

function parseHunterContactFitReviews(parsed: Record<string, unknown>): HunterContactFitReview[] {
  const reviews = readObjectArray(parsed.reviews).map((review) => ({
    contactId: readNonEmptyString(review.contactId),
    disposition: readEnumValue(
      review.disposition,
      ["PRIMARY", "SECONDARY", "REVIEW", "REJECT"] as const
    ),
    confidence: readInteger(review.confidence),
    responsibilityHypothesis: readNonEmptyString(review.responsibilityHypothesis),
    rationale: readNonEmptyString(review.rationale),
    recommendedApproach: readNonEmptyString(review.recommendedApproach),
    riskFlags: readStringArray(review.riskFlags)
  }));
  if (
    reviews.length === 0 ||
    reviews.some((review) =>
      !review.contactId ||
      !review.disposition ||
      review.confidence === null ||
      review.confidence < 0 ||
      review.confidence > 100 ||
      !review.responsibilityHypothesis ||
      !review.rationale ||
      !review.recommendedApproach
    )
  ) {
    throw new Error("OpenAI returned an incomplete Hunter contact-fit review.");
  }
  return reviews as HunterContactFitReview[];
}

function parseOutreachSequence(parsed: Record<string, unknown>): GeneratedOutreachSequence {
  const sequenceName = readNonEmptyString(parsed.sequenceName);
  const steps = readObjectArray(parsed.steps).map((step) => ({
    stepNumber: readInteger(step.stepNumber),
    channel: readEnumValue(step.channel, Object.values(OutreachChannel)),
    delayDays: readInteger(step.delayDays),
    subject: typeof step.subject === "string" && step.subject.trim() ? step.subject.trim() : null,
    body: readNonEmptyString(step.body),
    angle: readNonEmptyString(step.angle),
    evidenceRefs: readStringArray(step.evidenceRefs)
  }));

  if (
    !sequenceName ||
    steps.some(
      (step) =>
        step.stepNumber === null ||
        !step.channel ||
        step.delayDays === null ||
        !step.body ||
        !step.angle ||
        step.evidenceRefs.length === 0
    )
  ) {
    throw new Error("OpenAI returned an incomplete outreach sequence.");
  }

  return {
    sequenceName,
    steps: steps.map((step) => ({
      stepNumber: step.stepNumber as number,
      channel: step.channel as OutreachChannel,
      delayDays: step.delayDays as number,
      subject: step.subject,
      body: step.body as string,
      angle: step.angle as string,
      evidenceRefs: step.evidenceRefs
    }))
  };
}

function parseOutreachQaResult(parsed: Record<string, unknown>): ModelOutreachQaResult {
  const passed = typeof parsed.passed === "boolean" ? parsed.passed : null;
  const issues = readObjectArray(parsed.issues).map((issue) => ({
    code: readNonEmptyString(issue.code),
    severity: readEnumValue(issue.severity, ["ERROR", "WARNING"] as const),
    message: readNonEmptyString(issue.message),
    stepNumber: issue.stepNumber === null ? null : readInteger(issue.stepNumber)
  }));

  if (
    passed === null ||
    issues.some((issue) => !issue.code || !issue.severity || !issue.message || issue.stepNumber === undefined)
  ) {
    throw new Error("OpenAI returned an incomplete outreach QA result.");
  }

  const normalizedIssues = issues.map(
    (issue) =>
      ({
        code: issue.code as string,
        severity: issue.severity as OutreachQaIssue["severity"],
        message: issue.message as string,
        stepNumber: issue.stepNumber
      }) satisfies OutreachQaIssue
  );

  if (passed && normalizedIssues.some((issue) => issue.severity === "ERROR")) {
    throw new Error("OpenAI outreach QA marked a sequence passed while returning blocking errors.");
  }

  return {
    passed,
    issues: normalizedIssues
  };
}

function readInteger(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function readEnumValue<T extends string>(value: unknown, allowed: readonly T[]) {
  return typeof value === "string" && allowed.includes(value as T) ? (value as T) : null;
}

function parseApolloCompanySuggestionPayload(content: string) {
  let parsed: Record<string, unknown>;

  try {
    parsed = JSON.parse(content) as Record<string, unknown>;
  } catch {
    throw new Error("OpenAI returned a company suggestion response that was not valid JSON.");
  }

  const suggestedCompanyName = readNonEmptyString(parsed.suggestedCompanyName);
  const confidence = readConfidenceValue(parsed.confidence);
  const rationale = readNonEmptyString(parsed.rationale);

  if (!suggestedCompanyName || !confidence || !rationale) {
    throw new Error("OpenAI returned an incomplete company suggestion payload.");
  }

  return {
    suggestedCompanyName,
    confidence,
    rationale
  };
}

function extractOpenAiError(payload: Record<string, unknown> | null) {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const error = payload.error;
  if (error && typeof error === "object") {
    const message = (error as Record<string, unknown>).message;
    if (typeof message === "string" && message.trim().length > 0) {
      return message.trim();
    }
  }

  return null;
}

function readNonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim()) : [];
}

function readObjectArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && !Array.isArray(item))) : [];
}

function readConfidenceValue(value: unknown): ApolloCompanySuggestionResult["confidence"] | null {
  return value === "LOW" || value === "MEDIUM" || value === "HIGH" ? value : null;
}

function buildHeuristicApolloCompanySuggestion(
  context: ApolloCompanySuggestionContext
): ApolloCompanySuggestionResult {
  const normalized = normalizeCompanyName(context.companyName);
  const suggestedCompanyName = toDisplayCompanyName(normalized || context.companyName);
  const rationaleParts = [
    "Used fallback normalization to remove legal suffixes and punctuation.",
    context.latestMatchReason ? `Latest Apollo match reason: ${context.latestMatchReason}` : null
  ].filter((value): value is string => Boolean(value));

  return {
    suggestedCompanyName,
    confidence: "LOW",
    rationale: rationaleParts.join(" "),
    source: "heuristic",
    rawResponse: null
  };
}

function toDisplayCompanyName(value: string) {
  return value
    .split(/\s+/)
    .filter((token) => token.length > 0)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(" ");
}
