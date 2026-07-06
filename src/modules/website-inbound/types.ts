import type { WebsiteInboundStatus } from "@prisma/client";

export type WebsiteInboundFieldValue = string | string[];

export type WebsiteInboundSubmissionInput = {
  formType: string;
  source?: string;
  pageUrl?: string;
  fields: Record<string, WebsiteInboundFieldValue>;
};

export type WebsiteInboundStatusFilter = WebsiteInboundStatus | "ALL";
export type WebsiteInboundTypeFilter = string | "ALL";
