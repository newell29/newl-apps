import type { WebsiteInboundStatus } from "@prisma/client";

export type WebsiteInboundFieldValue = string | string[];

export type WebsiteInboundSubmissionInput = {
  formType: string;
  source?: string;
  pageUrl?: string;
  fields: Record<string, WebsiteInboundFieldValue>;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmTerm?: string;
  utmContent?: string;
  gclid?: string;
  gbraid?: string;
  wbraid?: string;
  gaClientId?: string;
  campaignId?: string;
  adGroupId?: string;
  creativeId?: string;
  matchType?: string;
  network?: string;
  device?: string;
  landingPage?: string;
  landingPath?: string;
  firstReferrer?: string;
  firstReferrerDomain?: string;
  sessionStartedAt?: string;
  submittedAt?: string;
  trafficSourceGuess?: string;
  attributionConfidence?: string | number;
  isTest?: boolean | string | number;
};

export type WebsiteInboundStatusFilter = WebsiteInboundStatus | "ALL";
export type WebsiteInboundTypeFilter = string | "ALL";
