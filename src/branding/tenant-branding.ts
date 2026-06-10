export type TenantBranding = {
  name: string;
  mark: string;
  wordmark: string;
  tagline: string;
  themeId: string;
};

export const defaultTenantBranding: TenantBranding = {
  name: "Newl Apps",
  mark: "N",
  wordmark: "NEWL",
  tagline: "Logistics operations platform",
  themeId: "newl-default"
};

// TODO: Load tenant branding from tenant-scoped settings once the auth/session
// tenant resolver exists. Newl is the default internal theme, not a platform
// assumption for third-party SaaS tenants.
