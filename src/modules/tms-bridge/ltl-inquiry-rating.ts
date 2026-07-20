import { getLtlRatePortalShell } from "@/modules/ltl-rate-portal/queries";
import type { LtlCarrierErrorResult, LtlQuoteResult, SevenLAccountConfig } from "@/modules/ltl-rate-portal/types";
import type { LogisticsInquiry, ParsedEmailLogisticsData } from "@/modules/tms-bridge/actions";
import {
  buildLtlRateRequestFromParsedInquiry,
  type LtlInquiryRateRequestResult
} from "@/modules/tms-bridge/ltl-inquiry-rate-request";
import { prisma } from "@/server/db";
import { fetchSevenLAvailableCarriers, getLtlQuotes } from "@/server/integrations/seven-l";
import type { TenantContext } from "@/server/tenant-context";

export type LtlInquiryRatingResult =
  | {
      status: "not_applicable";
      isLtl: false;
      adapter: null;
      quotes: [];
      errors: [];
      warning: null;
      accountName: null;
      enabledCarrierCount: 0;
    }
  | {
      status: "skipped";
      isLtl: true;
      adapter: LtlInquiryRateRequestResult;
      quotes: [];
      errors: [];
      warning: string;
      accountName: null;
      enabledCarrierCount: 0;
    }
  | {
      status: "quoted";
      isLtl: true;
      adapter: LtlInquiryRateRequestResult;
      quotes: LtlQuoteResult[];
      errors: LtlCarrierErrorResult[];
      warning: null;
      accountName: string;
      enabledCarrierCount: number;
    }
  | {
      status: "failed";
      isLtl: true;
      adapter: LtlInquiryRateRequestResult;
      quotes: [];
      errors: [];
      warning: string;
      accountName: string | null;
      enabledCarrierCount: number;
    };

type LtlInquiryRatingDependencies = {
  getTenantContext: () => Promise<TenantContext>;
  getShell: typeof getLtlRatePortalShell;
  getQuotes: typeof getLtlQuotes;
  getAvailableCarriers: typeof fetchSevenLAvailableCarriers;
};

export async function rateLtlInquiryIfApplicable(
  inquiry: ParsedEmailLogisticsData | LogisticsInquiry,
  dependencies: Partial<LtlInquiryRatingDependencies> = {}
): Promise<LtlInquiryRatingResult> {
  if (!isLtlInquiry(inquiry)) {
    return {
      status: "not_applicable",
      isLtl: false,
      adapter: null,
      quotes: [],
      errors: [],
      warning: null,
      accountName: null,
      enabledCarrierCount: 0
    };
  }

  const adapter = buildLtlRateRequestFromParsedInquiry(inquiry);
  if (!adapter.canRequestRates || !adapter.request) {
    return {
      status: "skipped",
      isLtl: true,
      adapter,
      quotes: [],
      errors: [],
      warning: "7L rating skipped because the parsed LTL inquiry is missing required rating fields.",
      accountName: null,
      enabledCarrierCount: 0
    };
  }

  const getTenantContext = dependencies.getTenantContext ?? getTmsBridgeTenantContext;
  const getShell = dependencies.getShell ?? getLtlRatePortalShell;
  const getQuotes = dependencies.getQuotes ?? getLtlQuotes;
  const getAvailableCarriers = dependencies.getAvailableCarriers ?? fetchSevenLAvailableCarriers;
  let account: SevenLAccountConfig | null = null;
  let carrierHashes: string[] = [];

  try {
    const tenant = await getTenantContext();
    const shell = await getShell(tenant);
    account = pickPreferredSevenLAccount(shell.accounts);

    if (!account) {
      return {
        status: "failed",
        isLtl: true,
        adapter,
        quotes: [],
        errors: [],
        warning: "7L rating failed because no active live 7L account with configured runtime credentials was found for the TMS bridge tenant.",
        accountName: null,
        enabledCarrierCount: 0
      };
    }

    const availableCarriers = await getAvailableCarriers(account).catch(() => account?.carriers ?? []);
    carrierHashes = availableCarriers.map((carrier) => carrier.carrierHash);
    if (carrierHashes.length === 0) {
      return {
        status: "failed",
        isLtl: true,
        adapter,
        quotes: [],
        errors: [],
        warning: `7L rating failed because the account ${account.name} has no enabled carriers selected.`,
        accountName: account.name,
        enabledCarrierCount: 0
      };
    }

    const response = await getQuotes(account, [adapter.request], carrierHashes);
    return {
      status: "quoted",
      isLtl: true,
      adapter,
      quotes: response.data,
      errors: response.errors,
      warning: null,
      accountName: account.name,
      enabledCarrierCount: carrierHashes.length
    };
  } catch (error) {
    return {
      status: "failed",
      isLtl: true,
      adapter,
      quotes: [],
      errors: [],
      warning: `7L rating failed: ${error instanceof Error ? error.message : "Unknown error."}`,
      accountName: account?.name ?? null,
      enabledCarrierCount: carrierHashes.length
    };
  }
}

export function isLtlInquiry(inquiry: Pick<ParsedEmailLogisticsData | LogisticsInquiry, "mode" | "shipmentType">) {
  return getTmsModeSelectorKey(inquiry.mode) === "trucking" && inquiry.shipmentType.trim().toUpperCase() === "LTL";
}

export function pickPreferredSevenLAccount(accounts: SevenLAccountConfig[]) {
  return accounts.find((account) => !account.dryRun && account.secretConfigured && account.status === "ACTIVE") ?? null;
}

async function getTmsBridgeTenantContext(): Promise<TenantContext> {
  const tenantSlug =
    process.env.TMS_BRIDGE_TENANT_SLUG?.trim() ||
    process.env.INGESTION_TENANT_SLUG?.trim() ||
    process.env.DEFAULT_TENANT_SLUG?.trim();

  if (!tenantSlug) {
    throw new Error("Set TMS_BRIDGE_TENANT_SLUG or DEFAULT_TENANT_SLUG before requesting 7L rates from the TMS bridge.");
  }

  const tenant = await prisma.tenant.findUnique({
    where: { slug: tenantSlug },
    select: {
      id: true,
      slug: true,
      name: true
    }
  });

  if (!tenant) {
    throw new Error(`No tenant was found for TMS bridge tenant slug ${tenantSlug}.`);
  }

  return {
    tenantId: tenant.id,
    tenantSlug: tenant.slug,
    tenantName: tenant.name
  };
}

function getTmsModeSelectorKey(mode: string): string {
  const normalizedMode = mode.trim().toLowerCase();
  if (normalizedMode === "drayage") {
    return "dryage";
  }

  if (normalizedMode === "warehousing") {
    return "warehouse";
  }

  if (normalizedMode === "ground") {
    return "trucking";
  }

  return normalizedMode;
}
