import { ModuleKey, PlatformRole } from "@prisma/client";

export type RolePolicy = {
  modules: ModuleKey[] | "ALL";
  canMutate: boolean;
};

export const ALL_MODULES: ModuleKey[] = Object.values(ModuleKey);

export const DEFAULT_ROLE_MATRIX: Record<PlatformRole, RolePolicy> = {
  [PlatformRole.ADMIN]: { modules: "ALL", canMutate: true },
  [PlatformRole.MANAGER]: { modules: "ALL", canMutate: true },
  [PlatformRole.SALES]: {
    modules: [ModuleKey.ASSISTANT, ModuleKey.LEAD_GEN, ModuleKey.CUSTOMER_CASHFLOW],
    canMutate: true
  },
  [PlatformRole.OPERATIONS]: {
    modules: [
      ModuleKey.ASSISTANT,
      ModuleKey.LEAD_GEN,
      ModuleKey.UPS_TOOLS,
      ModuleKey.LTL_RATE_PORTAL,
      ModuleKey.TRANSIT_LOOKUP,
      ModuleKey.CUSTOMER_CASHFLOW
    ],
    canMutate: true
  },
  [PlatformRole.FINANCE]: {
    modules: [
      ModuleKey.ASSISTANT,
      ModuleKey.INVOICE_VERIFICATION,
      ModuleKey.QUICKBOOKS_POSTING,
      ModuleKey.CUSTOMER_CASHFLOW
    ],
    canMutate: true
  },
  [PlatformRole.READ_ONLY]: { modules: "ALL", canMutate: false }
};

export const ROLE_DESCRIPTIONS: Record<
  PlatformRole,
  { label: string; description: string; visibilitySummary: string }
> = {
  [PlatformRole.ADMIN]: {
    label: "Admin",
    description: "Full tenant control, including settings, access, modules, and operational tooling.",
    visibilitySummary: "Can access every enabled module and manage tenant configuration."
  },
  [PlatformRole.MANAGER]: {
    label: "Manager",
    description: "Cross-functional operator who can work across enabled modules without tenant-admin powers.",
    visibilitySummary: "Can access every enabled module and make day-to-day changes."
  },
  [PlatformRole.SALES]: {
    label: "Sales",
    description: "Focused on lead generation, company review, pipeline progression, and contact workflows.",
    visibilitySummary: "Starts with Assistant and Lead Generation unless you expand it below."
  },
  [PlatformRole.OPERATIONS]: {
    label: "Operations",
    description: "Supports lead-gen operations plus shipment, quoting, and transit workflows.",
    visibilitySummary: "Starts with Assistant, Lead Generation, UPS Tools, LTL Rate Portal, and Transit Lookup."
  },
  [PlatformRole.FINANCE]: {
    label: "Finance",
    description: "Reserved for invoice verification and accounting-connected workflows.",
    visibilitySummary: "Starts with Assistant, Invoice Verification, and QuickBooks Posting."
  },
  [PlatformRole.READ_ONLY]: {
    label: "Read Only",
    description: "Can view assigned modules but cannot make mutations anywhere in the app.",
    visibilitySummary: "Visibility can be broad, but writes are always blocked."
  }
};

export function getDefaultAccessibleModuleKeys(role: PlatformRole): ModuleKey[] {
  const policy = DEFAULT_ROLE_MATRIX[role];
  return policy.modules === "ALL" ? [...ALL_MODULES] : [...policy.modules];
}
