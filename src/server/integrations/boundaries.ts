import type { TenantContext } from "@/server/tenant-context";

export interface TenantIntegrationBoundary {
  tenant: TenantContext;
  dryRun: boolean;
}

export interface ApolloBoundary extends TenantIntegrationBoundary {
  searchCompanies(query: string): Promise<never>;
  searchContacts(companyId: string): Promise<never>;
}

export interface TradeMiningBoundary extends TenantIntegrationBoundary {
  importRecentBolRecords(): Promise<never>;
}

// TODO: Implement tenant-scoped clients after public config and secret references are stored in
// IntegrationCredential. Secrets must be resolved from a managed secret store, never from source.
// Live Apollo, TradeMining, Google Sheets, QuickBooks, UPS, and OpenClaw calls must not be
// added directly to UI routes.
