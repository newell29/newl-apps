export type TenantBranding = {
  name: string;
  mark: string;
  themeId: string;
};

export const defaultTenantBranding: TenantBranding = {
  name: "Newl Apps",
  mark: "N",
  themeId: "newl-default"
};

// TODO: Load tenant branding from tenant-scoped settings once the auth/session
// tenant resolver exists. Newl is the default internal theme, not a platform
// assumption for third-party SaaS tenants.
