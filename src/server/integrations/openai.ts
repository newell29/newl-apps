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

const OPENAI_API_BASE_URL = "https://api.openai.com/v1";

export function isOpenAiDraftGenerationConfigured() {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  return Boolean(apiKey && apiKey !== "OPENAI_API_KEY_PLACEHOLDER");
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

function readAssistantContent(payload: Record<string, unknown>) {
  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  const message = choices[0] && typeof choices[0] === "object" ? (choices[0] as Record<string, unknown>).message : null;
  const content = message && typeof message === "object" ? (message as Record<string, unknown>).content : null;

  if (typeof content !== "string" || content.trim().length === 0) {
    throw new Error("OpenAI returned an empty draft response.");
  }

  return content;
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
