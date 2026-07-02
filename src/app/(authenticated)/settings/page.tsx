import { PageHeader } from "@/components/page-header";
import { InfoHint } from "@/components/info-hint";
import { PlatformRole } from "@prisma/client";
import { SearchProfileCadenceManager } from "@/modules/settings/components/search-profile-cadence-manager";
import { formatPlatformRole } from "@/modules/settings/access-control";
import {
  saveMicrosoftGraphSettingsAction,
  createCarrierPlaceholderAction,
  createUpsQuoteSourceAction,
  removeTenantUserAccessAction,
  saveAssistantProviderSettingsAction,
  saveApolloRepMappingAction,
  saveApolloSequenceMappingAction,
  saveRoleModuleAccessAction,
  saveTenantUserAccessAction,
  saveTradeMiningScoringSettingsAction,
  syncApolloRepMappingAction,
  syncApolloSequenceMappingAction,
  syncSevenLCarriersAction,
  updateSevenLCarrierSelectionAction
} from "@/modules/settings/actions";
import { getSettingsShell } from "@/modules/settings/queries";
import { connectMicrosoftGraphAction } from "@/server/auth/actions";
import { requireAdmin } from "@/server/auth/authorization";
import { getAuthenticatedContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

const leadGenAiModelOptions = [
  { value: "gpt-5.4-mini", label: "GPT-5.4 mini (Recommended)" },
  { value: "gpt-5.4-nano", label: "GPT-5.4 nano" },
  { value: "gpt-5.4", label: "GPT-5.4" },
  { value: "gpt-5.5", label: "GPT-5.5" }
] as const;

export default async function SettingsPage() {
  const context = await getAuthenticatedContext();
  requireAdmin(context);
  const settings = await getSettingsShell(context);
  const loginUrl = `${process.env.AUTH_URL ?? "https://newl-apps.vercel.app"}/login`;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={context.tenantName}
        title="Settings"
        description="Tenant-scoped configuration shell for modules, credentials, roles, and future billing."
      />

      <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-foreground">Settings workspace</h2>
            <p className="mt-1 text-sm leading-6 text-mutedForeground">
              Keep platform controls, lead generation strategy, and quote tooling in separate lanes so this page stays manageable as the app grows.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {[
              { href: "#platform-controls", label: "Platform controls" },
              { href: "#quickbooks", label: "QuickBooks" },
              { href: "#assistant-ai", label: "Assistant AI" },
              { href: "#microsoft-365", label: "Microsoft 365" },
              { href: "#user-access", label: "User access" },
              { href: "#lead-generation-settings", label: "Lead generation" },
              { href: "#quote-tools-settings", label: "Quote tools" }
            ].map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="rounded-full border border-border bg-background px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
              >
                {link.label}
              </a>
            ))}
          </div>
        </div>
      </section>

      <section id="platform-controls" className="space-y-3">
        <div>
          <h2 className="text-base font-semibold text-foreground">Platform Controls</h2>
          <p className="mt-1 text-sm text-mutedForeground">
            Tenant-wide module access and integration boundaries that affect the whole platform.
          </p>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
          <h2 className="text-base font-semibold text-foreground">Enabled Modules</h2>
          <div className="mt-4 space-y-3">
            {settings.modules.map((module) => (
              <div key={module.key} className="flex items-center justify-between gap-4 rounded-md border border-border bg-muted/40 p-3">
                <span className="font-medium text-foreground">{module.name}</span>
                <span className="rounded-full border border-success/25 bg-success/10 px-2.5 py-1 text-xs font-semibold text-success">
                  {module.enabled ? "Enabled" : "Disabled"}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
          <h2 className="text-base font-semibold text-foreground">Integration Boundaries</h2>
          <div className="mt-4 space-y-3 text-sm text-mutedForeground">
            {settings.integrationProviders.map((provider) => (
              <div key={provider} className="rounded-md border border-border bg-muted/40 p-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-medium text-foreground">{provider}</p>
                  <span className="rounded-full border border-warning/25 bg-warning/10 px-2.5 py-1 text-xs font-semibold text-warning">
                    Placeholder
                  </span>
                </div>
                <p className="mt-2">
                  Store non-secret tenant config and encrypted secret references separately before
                  enabling live API calls.
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="quickbooks" className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-4">
          <div>
            <h2 className="text-base font-semibold text-foreground">QuickBooks Connections</h2>
            <p className="mt-1 text-sm leading-6 text-mutedForeground">
              Connect each legal entity separately so finance imports can distinguish Newl Worldwide from Newl USA while reusing shared canonical customer identity.
            </p>
          </div>
          <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-mutedForeground">
            OAuth app creds come from `QUICKBOOKS_CLIENT_ID`, `QUICKBOOKS_CLIENT_SECRET`, and `QUICKBOOKS_REDIRECT_URI`.
          </div>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          {[
            { entity: "NEWL_WORLDWIDE", title: "Newl Worldwide", description: "Canada transport and third-party warehouse activity." },
            { entity: "NEWL_USA", title: "Newl USA", description: "US customers plus Charlotte warehousing operations." }
          ].map((target) => {
            const connection = settings.quickbooksConnections.find((item) => item.legalEntity === target.entity);

            return (
              <div key={target.entity} className="rounded-md border border-border bg-muted/40 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">{target.title}</h3>
                    <p className="mt-1 text-sm text-mutedForeground">{target.description}</p>
                  </div>
                  <span
                    className={[
                      "rounded-full px-2.5 py-1 text-xs font-semibold",
                      connection?.secretConfigured
                        ? "border border-success/25 bg-success/10 text-success"
                        : "border border-warning/25 bg-warning/10 text-warning"
                    ].join(" ")}
                  >
                    {connection?.secretConfigured ? "Connected" : "Not connected"}
                  </span>
                </div>

                <div className="mt-4 space-y-2 text-sm text-mutedForeground">
                  <p>Realm ID: {connection?.realmId ?? "Not connected yet"}</p>
                  <p>Company: {connection?.companyName ?? "Pending QuickBooks callback"}</p>
                  <p>Environment: {connection?.environment ?? "production"}</p>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  <a
                    href={`/api/integrations/quickbooks/connect?entity=${target.entity}`}
                    className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primaryForeground transition-colors hover:bg-primaryHover"
                  >
                    {connection ? "Reconnect QuickBooks" : "Connect QuickBooks"}
                  </a>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section id="assistant-ai" className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
          <div>
            <h2 className="text-base font-semibold text-foreground">Assistant AI</h2>
            <p className="mt-1 text-sm leading-6 text-mutedForeground">
              Configure the tenant-scoped assistant provider path. OpenAI is the interim low-cost option. A Newl-hosted local model is the long-term target.
            </p>
          </div>
          <span
            className={[
              "rounded-full px-2.5 py-1 text-xs font-semibold",
              settings.assistantProvider.liveResponsesEnabled
                ? "border border-success/25 bg-success/10 text-success"
                : "border border-border bg-background text-mutedForeground"
            ].join(" ")}
          >
            {settings.assistantProvider.liveResponsesEnabled ? "Live replies enabled" : "Deterministic fallback"}
          </span>
        </div>

        <form action={saveAssistantProviderSettingsAction} className="mt-4 space-y-4">
          <div className="grid gap-4 xl:grid-cols-2">
            <SelectField
              label="Assistant provider"
              name="assistantProvider"
              defaultValue={settings.assistantProvider.provider}
              options={[
                { value: "OPENAI", label: "OpenAI" },
                { value: "LOCAL_LLM", label: "Local LLM" }
              ]}
            />
            <OptionalField
              label="Local endpoint URL"
              name="assistantEndpointUrl"
              defaultValue={settings.assistantProvider.endpointUrl ?? ""}
              placeholder="http://assistant-internal:8000/v1"
              info="Used for the long-term local model path. Leave blank when OpenAI is active."
            />
            <Field
              label="Default model"
              name="assistantDefaultModel"
              defaultValue={settings.assistantProvider.defaultModel}
              placeholder="gpt-5-mini"
            />
            <OptionalField
              label="Fallback model"
              name="assistantFallbackModel"
              defaultValue={settings.assistantProvider.fallbackModel ?? ""}
              placeholder="gpt-5-nano"
              info="Used when the default model request fails."
            />
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground" htmlFor="assistantTemperature">
                Temperature
              </label>
              <input
                id="assistantTemperature"
                name="assistantTemperature"
                type="number"
                step="0.1"
                min="0"
                max="2"
                defaultValue={settings.assistantProvider.temperature}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
              />
              <p className="text-xs leading-5 text-mutedForeground">
                Lower values keep answers more controlled. Start conservative for an internal operations assistant.
              </p>
            </div>
            <NumberField
              label="Max tokens"
              name="assistantMaxTokens"
              defaultValue={settings.assistantProvider.maxTokens}
              min={100}
              max={4000}
              info="Caps reply size and cost."
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-4 rounded-md border border-border bg-background p-4">
            <div>
              <p className="text-sm font-medium text-foreground">Live assistant replies</p>
              <p className="mt-1 text-xs leading-5 text-mutedForeground">
                When off, the assistant stays on deterministic app-data fallback even if a provider is configured.
              </p>
            </div>
            <label className="flex items-center gap-2 text-sm font-medium text-foreground">
              <input
                type="checkbox"
                name="assistantLiveResponsesEnabled"
                value="true"
                defaultChecked={settings.assistantProvider.liveResponsesEnabled}
              />
              <span>Enable live replies</span>
            </label>
          </div>

          <div className="rounded-md border border-border bg-muted/30 p-4">
            <p className="text-sm font-medium text-foreground">Runtime status</p>
            <p className="mt-2 text-sm text-mutedForeground">{settings.assistantProvider.runtimeNotes}</p>
            <p className="mt-2 text-xs text-mutedForeground">
              {settings.assistantProvider.runtimeReady
                ? "Runtime prerequisites look present for the selected provider."
                : "Runtime prerequisites are incomplete for the selected provider."}
            </p>
          </div>

          <button className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primaryForeground transition-colors hover:bg-primaryHover">
            Save assistant settings
          </button>
        </form>
      </section>

      <section id="microsoft-365" className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
          <div>
            <h2 className="text-base font-semibold text-foreground">Microsoft 365</h2>
            <p className="mt-1 text-sm leading-6 text-mutedForeground">
              Control which inboxes and files the assistant can learn from. Shared mailbox targets are saved in tenant settings, so redeployments do not require re-entering them.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-success/25 bg-success/10 px-2.5 py-1 text-xs font-semibold text-success">
              Tenant-saved
            </span>
            <span
              className={[
                "rounded-full px-2.5 py-1 text-xs font-semibold",
                settings.microsoftGraph.mailboxAccessMode === "ADMIN_SELECTED_MAILBOXES"
                  ? "border border-accentBorder bg-accentSoft text-primary"
                  : "border border-border bg-background text-mutedForeground"
              ].join(" ")}
            >
              {settings.microsoftGraph.mailboxAccessMode === "ADMIN_SELECTED_MAILBOXES"
                ? "Admin-selected mailboxes"
                : "Signed-in user only"}
            </span>
            <span
              className={[
                "rounded-full px-2.5 py-1 text-xs font-semibold",
                settings.microsoftGraphUserConnection.connected
                  ? "border border-success/25 bg-success/10 text-success"
                  : "border border-warning/25 bg-warning/10 text-warning"
              ].join(" ")}
            >
              {settings.microsoftGraphUserConnection.connected ? "Delegated access connected" : "Delegated access not connected"}
            </span>
          </div>
        </div>

        <div className="mt-4 grid gap-4 xl:grid-cols-[1.2fr,0.8fr]">
          <form action={saveMicrosoftGraphSettingsAction} className="space-y-4">
            <SelectField
              label="Mailbox access mode"
              name="microsoftMailboxAccessMode"
              defaultValue={settings.microsoftGraph.mailboxAccessMode}
              options={[
                { value: "SIGNED_IN_USER", label: "Signed-in user only" },
                { value: "ADMIN_SELECTED_MAILBOXES", label: "Admin-selected mailboxes" }
              ]}
            />

            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground" htmlFor="microsoftAdminMailboxTargets">
                Shared and team inboxes
              </label>
              <textarea
                id="microsoftAdminMailboxTargets"
                name="microsoftAdminMailboxTargets"
                rows={6}
                defaultValue={settings.microsoftGraph.adminMailboxTargets.join("\n")}
                placeholder={"dispatch@newl.ca\nwarehouse@newl.ca\nsales@newl.ca"}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
              />
              <p className="text-xs leading-5 text-mutedForeground">
                Enter one mailbox per line. This list is stored in the tenant database and reused after future deployments.
              </p>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <label className="flex items-start justify-between gap-3 rounded-md border border-border bg-background p-4 text-sm text-foreground">
                <span>
                  <span className="block font-medium">Mail sync</span>
                  <span className="mt-1 block text-xs leading-5 text-mutedForeground">
                    Pull Outlook mail into assistant knowledge and customer memory.
                  </span>
                </span>
                <input
                  type="checkbox"
                  name="microsoftMailSyncEnabled"
                  value="true"
                  defaultChecked={settings.microsoftGraph.mailSyncEnabled}
                  className="mt-1"
                />
              </label>

              <label className="flex items-start justify-between gap-3 rounded-md border border-border bg-background p-4 text-sm text-foreground">
                <span>
                  <span className="block font-medium">File sync</span>
                  <span className="mt-1 block text-xs leading-5 text-mutedForeground">
                    Pull SharePoint and OneDrive documents into assistant retrieval.
                  </span>
                </span>
                <input
                  type="checkbox"
                  name="microsoftFileSyncEnabled"
                  value="true"
                  defaultChecked={settings.microsoftGraph.fileSyncEnabled}
                  className="mt-1"
                />
              </label>

              <label className="flex items-start justify-between gap-3 rounded-md border border-border bg-background p-4 text-sm text-foreground">
                <span>
                  <span className="block font-medium">Email drafting target</span>
                  <span className="mt-1 block text-xs leading-5 text-mutedForeground">
                    Save reviewed drafting intent for Outlook-based replies.
                  </span>
                </span>
                <input
                  type="checkbox"
                  name="microsoftDraftingEnabled"
                  value="true"
                  defaultChecked={settings.microsoftGraph.draftingEnabled}
                  className="mt-1"
                />
              </label>
            </div>

            <button className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primaryForeground transition-colors hover:bg-primaryHover">
              Save Microsoft 365 settings
            </button>
          </form>

          <div className="space-y-4">
            <div className="rounded-md border border-border bg-muted/30 p-4">
              <p className="text-sm font-medium text-foreground">Runtime status</p>
              <p className="mt-2 text-sm text-mutedForeground">{settings.microsoftGraph.runtimeNotes}</p>
              <p className="mt-3 text-xs leading-5 text-mutedForeground">
                {settings.microsoftGraphUserConnection.runtimeNotes}
              </p>
            </div>

            <div className="rounded-md border border-border bg-background p-4">
              <p className="text-sm font-medium text-foreground">Granted delegated scopes</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {settings.microsoftGraphUserConnection.scopes.length > 0 ? (
                  settings.microsoftGraphUserConnection.scopes.map((scope) => (
                    <span
                      key={scope}
                      className="rounded-full border border-border bg-card px-2.5 py-1 text-xs font-medium text-foreground"
                    >
                      {scope}
                    </span>
                  ))
                ) : (
                  <span className="text-xs text-mutedForeground">No delegated Microsoft scopes connected yet.</span>
                )}
              </div>
            </div>

            <form action={connectMicrosoftGraphAction} className="rounded-md border border-border bg-background p-4">
              <input type="hidden" name="callbackUrl" value="/settings#microsoft-365" />
              <p className="text-sm font-medium text-foreground">Reconnect delegated Microsoft access</p>
              <p className="mt-2 text-xs leading-5 text-mutedForeground">
                Use this after scope changes or if the current user needs to refresh Microsoft consent for Outlook and SharePoint access.
              </p>
              <button className="mt-4 rounded-md border border-border px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted">
                Connect Microsoft 365
              </button>
            </form>
          </div>
        </div>
      </section>

      <section id="user-access" className="space-y-3">
        <div>
          <h2 className="text-base font-semibold text-foreground">User Access</h2>
          <p className="mt-1 text-sm text-mutedForeground">
            Provision Microsoft sign-in users, assign their role, and decide which enabled modules each role can access inside this tenant.
          </p>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[0.9fr,1.1fr]">
        <form action={saveTenantUserAccessAction} className="rounded-lg border border-border bg-card p-5 shadow-sm">
          <h2 className="text-base font-semibold text-foreground">Add or Update User</h2>
          <p className="mt-1 text-sm leading-6 text-mutedForeground">
            Add someone by email before they sign in with Microsoft. If they already exist, this updates their role for this tenant.
          </p>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <Field label="Email" name="email" placeholder="alex.newell@newl.ca" />
            <OptionalField label="Name" name="name" placeholder="Alex Newell" />
            <SelectField
              label="Role"
              name="role"
              options={Object.values(PlatformRole).map((role) => ({
                value: role,
                label: formatPlatformRole(role)
              }))}
            />
          </div>
          <button className="mt-4 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primaryForeground transition-colors hover:bg-primaryHover">
            Save user access
          </button>
          <p className="mt-3 text-xs leading-5 text-mutedForeground">
            After saving access, use the invite link in Current Tenant Users to send them the Microsoft sign-in URL.
          </p>
        </form>

        <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
          <h2 className="text-base font-semibold text-foreground">Role Basics</h2>
          <p className="mt-1 text-sm leading-6 text-mutedForeground">
            Role type still controls mutation safety globally. Module settings below change what each role can see and enter, but <span className="font-medium text-foreground">Read Only</span> can never write and <span className="font-medium text-foreground">Settings</span> stays admin-only.
          </p>
          <div className="mt-4 space-y-3">
            {settings.roleAccessMatrix.map((entry) => (
              <div key={entry.role} className="rounded-md border border-border bg-muted/40 p-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="font-medium text-foreground">{entry.label}</p>
                  <span
                    className={[
                      "rounded-full px-2.5 py-1 text-xs font-semibold",
                      entry.canMutate
                        ? "border border-success/25 bg-success/10 text-success"
                        : "border border-border bg-background text-mutedForeground"
                    ].join(" ")}
                  >
                    {entry.canMutate ? "Can mutate" : "Read only"}
                  </span>
                </div>
                <p className="mt-2 text-sm text-mutedForeground">{entry.description}</p>
                <p className="mt-2 text-xs leading-5 text-mutedForeground">{entry.visibilitySummary}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
          <div>
            <h2 className="text-base font-semibold text-foreground">Current Tenant Users</h2>
            <p className="mt-1 text-sm leading-6 text-mutedForeground">
              These people are provisioned to sign in to this tenant through Microsoft Entra.
            </p>
          </div>
          <span className="rounded-full border border-accentBorder bg-accentSoft px-2.5 py-1 text-xs font-semibold text-primary">
            {settings.tenantUsers.length.toLocaleString("en-US")} users
          </span>
        </div>

        <div className="mt-4 overflow-x-auto rounded-md border border-border">
          <table className="min-w-full divide-y divide-border text-sm">
            <thead className="bg-muted text-left text-xs font-semibold uppercase text-mutedForeground">
              <tr>
                <th className="px-3 py-3">Name</th>
                <th className="px-3 py-3">Email</th>
                <th className="px-3 py-3">Role</th>
                <th className="px-3 py-3">Access added</th>
                <th className="px-3 py-3">Invite</th>
                <th className="px-3 py-3">Remove</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border bg-background">
              {settings.tenantUsers.map((user: {
                membershipId: string;
                email: string;
                name: string | null;
                role: string;
                createdAt: string;
              }) => (
                <tr key={user.membershipId}>
                  <td className="px-3 py-3 text-foreground">{user.name ?? "No name set"}</td>
                  <td className="px-3 py-3 text-mutedForeground">{user.email}</td>
                  <td className="px-3 py-3">
                    <span className="rounded-full border border-border bg-muted/40 px-2.5 py-1 text-xs font-semibold text-foreground">
                      {formatPlatformRole(user.role as PlatformRole)}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-mutedForeground">
                    {new Date(user.createdAt).toLocaleDateString("en-US", {
                      year: "numeric",
                      month: "short",
                      day: "numeric"
                    })}
                  </td>
                  <td className="px-3 py-3">
                    <a
                      href={buildInviteMailto({
                        email: user.email,
                        role: formatPlatformRole(user.role as PlatformRole),
                        loginUrl
                      })}
                      className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-muted"
                    >
                      Invite email
                    </a>
                  </td>
                  <td className="px-3 py-3">
                    <form action={removeTenantUserAccessAction}>
                      <input type="hidden" name="membershipId" value={user.membershipId} />
                      <button className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-muted">
                        Remove access
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
          <div>
            <h2 className="text-base font-semibold text-foreground">Role Module Visibility</h2>
            <p className="mt-1 text-sm leading-6 text-mutedForeground">
              Choose which tenant-enabled modules each role can access. This affects both navigation and authorization for app modules.
            </p>
          </div>
          <span className="rounded-full border border-warning/25 bg-warning/10 px-2.5 py-1 text-xs font-semibold text-warning">
            Settings remains admin-only
          </span>
        </div>

        <form action={saveRoleModuleAccessAction} className="mt-4 space-y-4">
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="min-w-full divide-y divide-border text-sm">
              <thead className="bg-muted text-left text-xs font-semibold uppercase text-mutedForeground">
                <tr>
                  <th className="px-3 py-3">Role</th>
                  <th className="px-3 py-3">Can edit</th>
                  {settings.modules.map((module) => (
                    <th key={module.key} className="px-3 py-3">
                      {module.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border bg-background">
                {settings.roleAccessMatrix.map((entry) => (
                  <tr key={entry.role}>
                    <td className="px-3 py-3 align-top">
                      <p className="font-medium text-foreground">{entry.label}</p>
                      <p className="mt-1 text-xs leading-5 text-mutedForeground">
                        {entry.canMutate ? "Can edit inside allowed modules." : "Can only view allowed modules."}
                      </p>
                    </td>
                    <td className="px-3 py-3 align-top">
                      <label className="flex items-center gap-2 text-sm text-foreground">
                        <input
                          type="checkbox"
                          name="roleCanMutate"
                          value={entry.role}
                          defaultChecked={entry.canMutate}
                          disabled={entry.canMutateLocked}
                        />
                        <span>{entry.canMutateLocked ? "Locked" : "Editable"}</span>
                      </label>
                    </td>
                    {settings.modules.map((module) => {
                      const moduleAccess = entry.modules.find((item) => item.key === module.key);
                      return (
                        <td key={`${entry.role}-${module.key}`} className="px-3 py-3 align-top">
                          <label className="flex items-center gap-2 text-sm text-foreground">
                            <input
                              type="checkbox"
                              name="roleModuleAccess"
                              value={`${entry.role}::${module.key}`}
                              defaultChecked={moduleAccess?.enabled}
                              disabled={!module.enabled}
                            />
                            <span>{module.enabled ? "Visible" : "Tenant disabled"}</span>
                          </label>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <button className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primaryForeground transition-colors hover:bg-primaryHover">
            Save role module access
          </button>
        </form>
      </section>

      <section id="lead-generation-settings" className="space-y-3">
        <div>
          <h2 className="text-base font-semibold text-foreground">Lead Generation</h2>
          <p className="mt-1 text-sm text-mutedForeground">
            Ownership mapping and ranking strategy for TradeMining companies and Apollo-ready contacts.
          </p>
        </div>
      </section>

      <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
          <div>
            <h2 className="text-base font-semibold text-foreground">Default Apollo Cadence Mapping</h2>
            <p className="mt-1 text-sm leading-6 text-mutedForeground">
              Set the tenant-wide fallback cadence structure first. Search profiles can then inherit this default or override it with their own Houston-, Charlotte-, or lane-specific strategy.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="rounded-full border border-accentBorder bg-accentSoft px-2.5 py-1 text-xs font-semibold text-primary">
              {settings.apolloSequenceOptions.length.toLocaleString("en-US")} active cadences
            </span>
            <form action={syncApolloSequenceMappingAction}>
              <button className="rounded-md border border-border px-3 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted">
                Sync Apollo cadences
              </button>
            </form>
          </div>
        </div>

        <form action={saveApolloSequenceMappingAction} className="mt-4 space-y-4">
          <ApolloCadenceMappingTable
            entries={settings.apolloSequenceMapping}
            options={settings.apolloSequenceOptions}
          />

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-mutedForeground">
              This only changes recommendation logic and future Apollo readiness. It does not enroll anyone into a cadence on its own.
            </p>
            <button className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primaryForeground transition-colors hover:bg-primaryHover">
              Save cadence mapping
            </button>
          </div>
        </form>

        {settings.apolloSequenceDirectory.length > 0 ? (
          <div className="mt-4 rounded-md border border-border bg-background p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-foreground">Synced cadence directory</h3>
                <p className="mt-1 text-xs text-mutedForeground">
                  Active Apollo cadences available for mapping right now.
                </p>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {settings.apolloSequenceDirectory
                .filter((entry) => entry.active && !entry.archived)
                .map((entry) => (
                  <span
                    key={entry.id}
                    className="rounded-full border border-border bg-card px-2.5 py-1 text-xs font-medium text-foreground"
                  >
                    {entry.name}
                  </span>
                ))}
            </div>
          </div>
        ) : (
          <p className="mt-4 text-sm text-mutedForeground">
            No Apollo cadences are synced yet. Use <span className="font-medium text-foreground">Sync Apollo cadences</span> to import the current active sequences first.
          </p>
        )}
      </section>

      <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
          <div>
            <h2 className="text-base font-semibold text-foreground">Search Profile Cadence Strategies</h2>
            <p className="mt-1 text-sm leading-6 text-mutedForeground">
              Override the default cadence mapping when a specific TradeMining profile needs different outreach. You can also copy an existing profile&apos;s cadence setup to a new profile, then make only the small changes.
            </p>
          </div>
          <span className="rounded-full border border-accentBorder bg-accentSoft px-2.5 py-1 text-xs font-semibold text-primary">
            {settings.searchProfileCadenceMappings.length.toLocaleString("en-US")} profiles
          </span>
        </div>

        <div className="mt-4 space-y-4">
          <SearchProfileCadenceManager
            profiles={settings.searchProfileCadenceMappings}
            options={settings.apolloSequenceOptions}
          />
        </div>
      </section>

      <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
          <div>
            <h2 className="text-base font-semibold text-foreground">Apollo Rep Mapping</h2>
            <p className="mt-1 text-sm leading-6 text-mutedForeground">
              Sync Apollo teammates into a tenant-scoped ownership directory, then maintain send-from email routing here for Pipeline assignment and sequence prep.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="rounded-full border border-accentBorder bg-accentSoft px-2.5 py-1 text-xs font-semibold text-primary">
              {settings.apolloRepMapping.length.toLocaleString("en-US")} synced reps
            </span>
            <form action={syncApolloRepMappingAction}>
              <button className="rounded-md border border-border px-3 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted">
                Sync Apollo reps
              </button>
            </form>
          </div>
        </div>

        <form action={saveApolloRepMappingAction} className="mt-4 space-y-4">
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="min-w-full divide-y divide-border text-sm">
              <thead className="bg-muted text-left text-xs font-semibold uppercase text-mutedForeground">
                <tr>
                  <th className="px-3 py-3">Active</th>
                  <th className="px-3 py-3">Owner name</th>
                  <th className="px-3 py-3">Apollo user ID</th>
                  <th className="px-3 py-3">Send-from email</th>
                  <th className="px-3 py-3">Apollo email account ID</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border bg-background">
                {buildApolloRepRows(settings.apolloRepMapping).map((entry, index) => (
                  <tr key={entry.id}>
                    <td className="px-3 py-3">
                      <input
                        type="checkbox"
                        name="apolloRepActiveIndex"
                        value={String(index)}
                        defaultChecked={entry.active}
                        className="mt-1"
                      />
                    </td>
                    <td className="px-3 py-3">
                      <input type="hidden" name="apolloRepSequenceOwnerName" defaultValue={entry.sequenceOwnerName} />
                      <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-foreground">
                        {entry.sequenceOwnerName}
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <input type="hidden" name="apolloRepUserId" defaultValue={entry.apolloUserId ?? ""} />
                      <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-mutedForeground">
                        {entry.apolloUserId ?? "Missing Apollo user ID"}
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <input
                        name="apolloRepSendFromEmail"
                        defaultValue={entry.sendFromEmail ?? ""}
                        placeholder="rep@newlgroup.com"
                        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
                      />
                    </td>
                    <td className="px-3 py-3">
                      <input
                        name="apolloRepSendFromEmailAccountId"
                        defaultValue={entry.sendFromEmailAccountId ?? ""}
                        placeholder="Auto-filled from Apollo sync"
                        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-mutedForeground">
              Owner name and Apollo user ID are synced from Apollo. The Apollo email account ID should resolve from the send-from mailbox during sync and is not usually the plain email address itself. Only active reps appear in Pipeline assignment.
            </p>
            <button className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primaryForeground transition-colors hover:bg-primaryHover">
              Save Apollo rep mapping
            </button>
          </div>
        </form>
        {settings.apolloRepMapping.length === 0 ? (
          <p className="mt-4 text-sm text-mutedForeground">
            No Apollo reps are synced yet. Use <span className="font-medium text-foreground">Sync Apollo reps</span> to import teammate records from Apollo first.
          </p>
        ) : null}
      </section>

      <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
          <div>
            <h2 className="text-base font-semibold text-foreground">TradeMining Scoring</h2>
            <p className="mt-1 text-sm leading-6 text-mutedForeground">
              Tune lead ranking for the TradeMining trial without changing the existing Sheets workflow. These settings control growth, profile fit, industry preference, company size bias, and workflow penalties.
            </p>
          </div>
          <span className="rounded-full border border-warning/25 bg-warning/10 px-2.5 py-1 text-xs font-semibold text-warning">
            Deterministic scoring
          </span>
        </div>

        {settings.tradeMiningScoringConfigWarning ? (
          <div className="mt-4 rounded-md border border-warning/25 bg-warning/10 px-4 py-3 text-sm text-warning">
            {settings.tradeMiningScoringConfigWarning}
          </div>
        ) : null}

        <form action={saveTradeMiningScoringSettingsAction} className="mt-4 space-y-6">
          <div className="grid gap-4 xl:grid-cols-3">
            <div className="rounded-md border border-border bg-background p-4">
              <h3 className="text-sm font-semibold text-foreground">Windows</h3>
              <div className="mt-4 grid gap-3">
                <NumberField
                  label="Recent window (days)"
                  name="recentWindowDays"
                  defaultValue={settings.tradeMiningScoring.recentWindowDays}
                  min={7}
                  max={365}
                  info="How far back we count current shipment activity when measuring present momentum and company size."
                />
                <NumberField
                  label="Comparison window (days)"
                  name="comparisonWindowDays"
                  defaultValue={settings.tradeMiningScoring.comparisonWindowDays}
                  min={7}
                  max={365}
                  info="The prior period used to compare against the recent window. This is what lets us tell whether activity is rising or softening."
                />
                <NumberField
                  label="Scoring lookback (days)"
                  name="lookbackWindowDays"
                  defaultValue={settings.tradeMiningScoring.lookbackWindowDays}
                  min={30}
                  max={365}
                  info="Maximum history considered when summarizing a company’s TradeMining evidence for ranking."
                />
              </div>
            </div>

            <div className="rounded-md border border-border bg-background p-4">
              <h3 className="text-sm font-semibold text-foreground">Weights</h3>
              <div className="mt-4 grid gap-3">
                <NumberField label="Momentum" name="momentumWeight" defaultValue={settings.tradeMiningScoring.momentumWeight} min={0} max={100} info="Rewards companies whose shipment count or volume is increasing in the recent window." />
                <NumberField label="Market fit" name="marketFitWeight" defaultValue={settings.tradeMiningScoring.marketFitWeight} min={0} max={100} info="Scores destination, origin, product fit, search profile priority, and your preferred lane biases." />
                <NumberField label="Industry fit" name="industryFitWeight" defaultValue={settings.tradeMiningScoring.industryFitWeight} min={0} max={100} info="Boosts or reduces leads based on preferred or deprioritized product keywords and HS code prefixes." />
                <NumberField label="Company size" name="companySizeWeight" defaultValue={settings.tradeMiningScoring.companySizeWeight} min={0} max={100} info="Lets you favor mid-market importers and reduce huge accounts that look too large for the current motion." />
                <NumberField label="Role" name="roleWeight" defaultValue={settings.tradeMiningScoring.roleWeight} min={0} max={100} info="Values stronger company roles, like consignee/importer evidence, over weaker source roles." />
                <NumberField label="Confidence" name="confidenceWeight" defaultValue={settings.tradeMiningScoring.confidenceWeight} min={0} max={100} info="Rewards rows that are complete and easier to trust because key fields are actually present." />
                <NumberField label="Workflow" name="workflowWeight" defaultValue={settings.tradeMiningScoring.workflowWeight} min={0} max={100} info="Uses existing Newl workflow context, such as company priority and whether a company is already in pipeline." />
              </div>
            </div>

            <div className="rounded-md border border-border bg-background p-4">
              <h3 className="text-sm font-semibold text-foreground">Company size rules</h3>
              <div className="mt-4 grid gap-3">
                <DecimalField
                  label="Mid-market TEU min"
                  name="midMarketTeuMin"
                  defaultValue={settings.tradeMiningScoring.midMarketTeuMin}
                  placeholder="2"
                  info="If a company’s recent total TEU lands inside your mid-market range, it becomes eligible for the mid-market boost."
                />
                <DecimalField
                  label="Mid-market TEU max"
                  name="midMarketTeuMax"
                  defaultValue={settings.tradeMiningScoring.midMarketTeuMax}
                  placeholder="15"
                  info="Upper bound for your preferred mid-market importer range."
                />
                <NumberField label="Mid-market boost" name="midMarketBoost" defaultValue={settings.tradeMiningScoring.midMarketBoost} min={0} max={100} info="How many points to add when the recent TEU falls inside the preferred mid-market range." />
                <DecimalField
                  label="Oversize TEU threshold"
                  name="oversizeTeuThreshold"
                  defaultValue={settings.tradeMiningScoring.oversizeTeuThreshold}
                  placeholder="30"
                  info="If recent TEU is above this level, the company is treated as potentially too large and can be penalized."
                />
                <NumberField
                  label="Oversize shipments in recent window"
                  name="oversizeShipmentCount30dThreshold"
                  defaultValue={settings.tradeMiningScoring.oversizeShipmentCount30dThreshold ?? undefined}
                  min={1}
                  max={500}
                  info="Alternative oversize rule based on shipment count instead of TEU. Helpful when volume is sparse but cadence is very high."
                />
                <NumberField label="Oversize penalty" name="oversizePenalty" defaultValue={settings.tradeMiningScoring.oversizePenalty} min={0} max={100} info="How many points to subtract when the account looks too large for the current sales motion." />
              </div>
            </div>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <TextAreaField
              label="Preferred origin countries"
              name="preferredOriginCountries"
              defaultValue={settings.tradeMiningScoring.preferredOriginCountries.join("\n")}
              description="Boosts leads coming from these countries. One per line or comma-separated."
              info="Use this when some source geographies are better fits for your current network or sales strategy. This boosts matching leads; it does not filter everything else out."
            />
            <TextAreaField
              label="Deprioritized origin countries"
              name="penalizedOriginCountries"
              defaultValue={settings.tradeMiningScoring.penalizedOriginCountries.join("\n")}
              description="Reduces score for these origin countries without excluding them."
              info="Helpful when a country is technically in-scope but tends to be a weaker fit right now. Matching leads still stay in the pool unless filtered at the search layer."
            />
            <TextAreaField
              label="Preferred origin ports"
              name="preferredOriginPorts"
              defaultValue={settings.tradeMiningScoring.preferredOriginPorts.join("\n")}
              description="Boosts shipments tied to these source ports."
              info="Useful when you know certain ports align better with your lanes, partners, or ideal customer profile."
            />
            <TextAreaField
              label="Deprioritized origin ports"
              name="penalizedOriginPorts"
              defaultValue={settings.tradeMiningScoring.penalizedOriginPorts.join("\n")}
              description="Reduces score for these source ports."
              info="This is a scoring bias only. It lowers priority for matching leads rather than fully blocking them."
            />
            <TextAreaField
              label="Preferred destination markets"
              name="preferredDestinationMarkets"
              defaultValue={settings.tradeMiningScoring.preferredDestinationMarkets.join("\n")}
              description="Boosts shipments landing in these inland or metro markets."
              info="Use this when some destination markets are more strategic than others even inside the same general search profile."
            />
            <TextAreaField
              label="Deprioritized destination markets"
              name="penalizedDestinationMarkets"
              defaultValue={settings.tradeMiningScoring.penalizedDestinationMarkets.join("\n")}
              description="Reduces score for less attractive destination markets."
              info="Again, this changes ranking rather than inclusion. The lead can still appear if the rest of the signal is strong."
            />
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <TextAreaField
              label="Preferred industry keywords"
              name="preferredIndustryKeywords"
              defaultValue={settings.tradeMiningScoring.preferredIndustryKeywords.join("\n")}
              description="One per line or comma-separated."
              info="If the product description contains these terms, the lead gets an industry-fit boost."
            />
            <TextAreaField
              label="Penalized industry keywords"
              name="penalizedIndustryKeywords"
              defaultValue={settings.tradeMiningScoring.penalizedIndustryKeywords.join("\n")}
              description="Use this for brokers, carriers, or categories you do not want to prioritize."
              info="These do not exclude a lead. They simply reduce the industry-fit portion of the score."
            />
            <TextAreaField
              label="Preferred HS code prefixes"
              name="preferredHsCodePrefixes"
              defaultValue={settings.tradeMiningScoring.preferredHsCodePrefixes.join("\n")}
              description="Prefix matches are supported."
              info="These increase score when a lead’s HS code starts with one of these prefixes. They do not act as a hard filter."
            />
            <TextAreaField
              label="Penalized HS code prefixes"
              name="penalizedHsCodePrefixes"
              defaultValue={settings.tradeMiningScoring.penalizedHsCodePrefixes.join("\n")}
              description="Leave blank if unused."
              info="These reduce score when matched. They still do not exclude the lead unless your upstream TradeMining search filtered it out separately."
            />
          </div>

          <div className="rounded-md border border-border bg-background p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-foreground">Contact scoring</h3>
                <p className="mt-1 text-sm text-mutedForeground">
                  Controls how approved-company contacts are ranked into tiers before sequence selection. This is separate from company scoring, but it uses the same tenant strategy record so updates stay together.
                </p>
              </div>
              <span className="rounded-full border border-accentBorder bg-accentSoft px-2.5 py-1 text-xs font-semibold text-primary">
                Deterministic tiers
              </span>
            </div>

            <div className="mt-4 grid gap-4 xl:grid-cols-3">
              <div className="rounded-md border border-border bg-card p-4">
                <h4 className="text-sm font-semibold text-foreground">Role weights</h4>
                <div className="mt-4 grid gap-3">
                  <NumberField
                    label="Decision-maker title weight"
                    name="contactDecisionMakerWeight"
                    defaultValue={settings.tradeMiningScoring.contactDecisionMakerWeight}
                    min={0}
                    max={100}
                    info="Applied when the title looks like a strong buying role such as owner, founder, VP, head, director, president, or chief."
                  />
                  <NumberField
                    label="Manager title weight"
                    name="contactManagerWeight"
                    defaultValue={settings.tradeMiningScoring.contactManagerWeight}
                    min={0}
                    max={100}
                    info="Applied when the contact is manager-, lead-, or supervisor-level but not clearly executive."
                  />
                  <NumberField
                    label="Logistics department weight"
                    name="contactLogisticsDepartmentWeight"
                    defaultValue={settings.tradeMiningScoring.contactLogisticsDepartmentWeight}
                    min={0}
                    max={100}
                    info="Boost for contacts whose title or department points to logistics, imports, transportation, procurement, warehouse, distribution, or operations."
                  />
                  <NumberField
                    label="Weak-function penalty"
                    name="contactWeakFunctionPenalty"
                    defaultValue={settings.tradeMiningScoring.contactWeakFunctionPenalty}
                    min={0}
                    max={100}
                    info="Penalty for roles that usually sit outside the buying motion, like HR, legal, marketing, finance, or IT."
                  />
                  <NumberField
                    label="Account quality max boost"
                    name="contactCompanyContextWeight"
                    defaultValue={settings.tradeMiningScoring.contactCompanyContextWeight}
                    min={0}
                    max={50}
                    info="Maximum contact-score boost that can come from the underlying company score. Example: with 15 here, a company scored 80 contributes about 12 points, a company scored 50 contributes about 8, and a company scored 20 contributes about 3."
                  />
                </div>
                <div className="mt-4 rounded-md border border-dashed border-border bg-background px-3 py-3 text-xs leading-5 text-mutedForeground">
                  This does not replace contact-level scoring. It only adds a scaled company-context boost on top of title, department, seniority, and data quality. Higher values make contacts at strong accounts rise faster, while lower values keep the contact role fit as the main driver.
                </div>
              </div>

              <div className="rounded-md border border-border bg-card p-4">
                <h4 className="text-sm font-semibold text-foreground">Data and workflow</h4>
                <div className="mt-4 grid gap-3">
                  <NumberField
                    label="Email weight"
                    name="contactEmailWeight"
                    defaultValue={settings.tradeMiningScoring.contactEmailWeight}
                    min={0}
                    max={50}
                    info="Boost for a direct email. Higher values make reachable contacts float upward faster."
                  />
                  <NumberField
                    label="LinkedIn weight"
                    name="contactLinkedinWeight"
                    defaultValue={settings.tradeMiningScoring.contactLinkedinWeight}
                    min={0}
                    max={50}
                    info="Boost for a LinkedIn profile that gives the rep more confidence on role and identity."
                  />
                  <NumberField
                    label="Phone weight"
                    name="contactPhoneWeight"
                    defaultValue={settings.tradeMiningScoring.contactPhoneWeight}
                    min={0}
                    max={50}
                    info="Boost for phone availability."
                  />
                  <NumberField
                    label="Primary-contact boost"
                    name="contactPrimaryContactBoost"
                    defaultValue={settings.tradeMiningScoring.contactPrimaryContactBoost}
                    min={0}
                    max={50}
                    info="Extra weight when a contact has already been selected as the current primary contact."
                  />
                  <NumberField
                    label="Approved-status boost"
                    name="contactApprovedStatusBoost"
                    defaultValue={settings.tradeMiningScoring.contactApprovedStatusBoost}
                    min={0}
                    max={50}
                    info="Extra points when the contact is already approved."
                  />
                  <NumberField
                    label="Reviewing-status boost"
                    name="contactReviewingStatusBoost"
                    defaultValue={settings.tradeMiningScoring.contactReviewingStatusBoost}
                    min={0}
                    max={50}
                    info="Smaller boost while the contact is still in active review."
                  />
                </div>
              </div>

              <div className="rounded-md border border-border bg-card p-4">
                <h4 className="text-sm font-semibold text-foreground">Tier thresholds</h4>
                <div className="mt-4 grid gap-3">
                  <NumberField
                    label="Tier 1 threshold"
                    name="contactTier1Threshold"
                    defaultValue={settings.tradeMiningScoring.contactTier1Threshold}
                    min={0}
                    max={100}
                    info="Minimum score to recommend the strongest sequence tier."
                  />
                  <NumberField
                    label="Tier 2 threshold"
                    name="contactTier2Threshold"
                    defaultValue={settings.tradeMiningScoring.contactTier2Threshold}
                    min={0}
                    max={100}
                    info="Minimum score for the middle tier."
                  />
                  <NumberField
                    label="Tier 3 threshold"
                    name="contactTier3Threshold"
                    defaultValue={settings.tradeMiningScoring.contactTier3Threshold}
                    min={0}
                    max={100}
                    info="Minimum score to stay ranked instead of dropping to unranked."
                  />
                </div>
              </div>
            </div>

            <div className="mt-4 grid gap-4 xl:grid-cols-2">
              <TextAreaField
                label="Preferred contact title keywords"
                name="preferredContactTitleKeywords"
                defaultValue={settings.tradeMiningScoring.preferredContactTitleKeywords.join("\n")}
                description="Boosts titles containing any of these words or phrases."
                info="Examples: owner, founder, president, director, vice president. These increase score; they do not act as a hard filter."
              />
              <TextAreaField
                label="Penalized contact title keywords"
                name="penalizedContactTitleKeywords"
                defaultValue={settings.tradeMiningScoring.penalizedContactTitleKeywords.join("\n")}
                description="Reduces role fit when the title contains these terms."
                info="Useful for roles that tend to be junior, indirect, or not part of the buying motion."
              />
              <TextAreaField
                label="Preferred contact departments"
                name="preferredContactDepartments"
                defaultValue={settings.tradeMiningScoring.preferredContactDepartments.join("\n")}
                description="Boosts departments and functions you want to prioritize."
                info="Examples: logistics, supply chain, operations, imports, procurement. Matches add score but do not exclude other contacts."
              />
              <TextAreaField
                label="Penalized contact departments"
                name="penalizedContactDepartments"
                defaultValue={settings.tradeMiningScoring.penalizedContactDepartments.join("\n")}
                description="Deprioritizes departments that are less likely to convert."
                info="Useful for HR, finance, IT, legal, marketing, and similar functions that are usually weak outreach targets for this motion."
              />
            </div>
          </div>

          <div className="rounded-md border border-border bg-background p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-foreground">Lead-gen AI runtime</h3>
                <p className="mt-1 text-sm text-mutedForeground">
                  Deterministic scoring still drives ranking. This model now powers Tier 1 draft writing and AI-assisted Apollo company review when matching needs help.
                </p>
              </div>
              <label className="flex items-center gap-2 text-sm font-medium text-foreground">
                <input
                  type="checkbox"
                  name="aiClassificationEnabled"
                  value="true"
                  defaultChecked={settings.tradeMiningScoring.aiClassificationEnabled}
                />
                Enable lead-gen AI
              </label>
            </div>
            <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,22rem),1fr]">
              <SelectField
                label="OpenAI model"
                name="aiModel"
                defaultValue={settings.tradeMiningScoring.aiModel ?? "gpt-5.4-mini"}
                options={leadGenAiModelOptions.map((option) => ({
                  value: option.value,
                  label: option.label
                }))}
              />
              <div className="rounded-md border border-border bg-muted/30 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={[
                      "rounded-full px-2.5 py-1 text-xs font-semibold",
                      settings.leadGenAiRuntimeReady
                        ? "border border-success/25 bg-success/10 text-success"
                        : "border border-warning/25 bg-warning/10 text-warning"
                    ].join(" ")}
                  >
                    {settings.leadGenAiRuntimeReady ? "OpenAI key detected" : "OpenAI key missing"}
                  </span>
                  <InfoHint text="For now, the lead-generation OpenAI key comes from the server environment as OPENAI_API_KEY rather than being stored inside tenant settings." />
                </div>
                <p className="mt-3 text-sm leading-6 text-mutedForeground">{settings.leadGenAiRuntimeNotes}</p>
                <p className="mt-2 text-xs leading-5 text-mutedForeground">
                  OpenAI&apos;s current model guide recommends smaller variants when optimizing for latency and cost. We default to <span className="font-medium text-foreground">gpt-5.4-mini</span> so drafts stay affordable while still being strong enough for outbound personalization.
                </p>
              </div>
            </div>
          </div>

          <button
            type="submit"
            disabled={Boolean(settings.tradeMiningScoringConfigWarning)}
            className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primaryForeground transition-colors hover:bg-primaryHover disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-primary"
          >
            {settings.tradeMiningScoringConfigWarning ? "Scoring table migration required" : "Save scoring settings"}
          </button>
        </form>

        <div className="mt-6 rounded-md border border-border bg-background p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-foreground">Current strategy summary</h3>
              <p className="mt-1 text-sm text-mutedForeground">
                This reflects the scoring strategy currently loaded for this tenant.
              </p>
            </div>
            <span className="rounded-full border border-accentBorder bg-accentSoft px-2.5 py-1 text-xs font-semibold text-primary">
              Live summary
            </span>
          </div>

          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            <SummaryCard
              title="Momentum focus"
              body={`Comparing ${settings.tradeMiningScoring.recentWindowDays} recent days against ${settings.tradeMiningScoring.comparisonWindowDays} prior days with a ${settings.tradeMiningScoring.momentumWeight}-point momentum weight.`}
            />
            <SummaryCard
              title="Lane bias"
              body={formatLaneSummary(settings.tradeMiningScoring)}
            />
            <SummaryCard
              title="Industry bias"
              body={formatIndustrySummary(settings.tradeMiningScoring)}
            />
            <SummaryCard
              title="Company size bias"
              body={formatCompanySizeSummary(settings.tradeMiningScoring)}
            />
            <SummaryCard
              title="Workflow context"
              body={`Workflow contributes ${settings.tradeMiningScoring.workflowWeight} points and confidence contributes ${settings.tradeMiningScoring.confidenceWeight} points when the TradeMining row is complete and the company is not already deep in pipeline.`}
            />
            <SummaryCard
              title="Contact ranking"
              body={formatContactScoringSummary(settings.tradeMiningScoring)}
            />
            <SummaryCard
              title="AI status"
              body={
                settings.tradeMiningScoring.aiClassificationEnabled
                  ? `Lead-gen AI is enabled with ${settings.tradeMiningScoring.aiModel ?? "the configured model"}. Deterministic scoring still ranks companies and contacts, while the model handles draft writing and company-review assistance.`
                  : "Lead-gen AI is currently off; deterministic scoring is still the source of truth and automatic Tier 1 draft generation stays disabled."
              }
            />
          </div>
        </div>
      </section>

      <section id="quote-tools-settings" className="space-y-3">
        <div>
          <h2 className="text-base font-semibold text-foreground">Quote Tools</h2>
          <p className="mt-1 text-sm text-mutedForeground">
            Sources and carrier-account configuration for UPS and LTL quoting workflows.
          </p>
        </div>
      </section>

      <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
          <div>
            <h2 className="text-base font-semibold text-foreground">Quote Sources</h2>
            <p className="mt-1 text-sm leading-6 text-mutedForeground">
              Manage the source records that can feed Shipment Rate Quote and Prospect Quote Generator. UPS accounts are quotable today; planned carriers can be staged here now and promoted later when their API boundary is wired.
            </p>
          </div>
          <span className="rounded-full border border-warning/25 bg-warning/10 px-2.5 py-1 text-xs font-semibold text-warning">
            {settings.quoteSources.length.toLocaleString("en-US")} total
          </span>
        </div>

        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {settings.quoteSources.map((source) => (
            <div key={source.id} className="rounded-md border border-border bg-muted/40 p-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-medium text-foreground">{source.displayName}</p>
                  <p className="mt-1 text-sm text-mutedForeground">
                    {source.carrierName} • {source.carrierCode} • {source.readiness === "live" ? "Live-ready" : "Planned"}
                  </p>
                </div>
                <span className="rounded-full border border-accentBorder bg-accentSoft px-2.5 py-1 text-xs font-semibold text-primary">
                  {source.sourceKind === "UPS_ACCOUNT" ? "UPS account" : "Future carrier"}
                </span>
              </div>
              <p className="mt-3 text-sm text-mutedForeground">
                {source.shipperNumber
                  ? `${source.originLabel} (${source.originPostalCode}) • ${source.shipperNumber}`
                  : source.notes ?? "Will appear in quote tooling as a planned source until its integration is connected."}
              </p>
              <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold">
                {source.toolTargets.map((target) => (
                  <span key={target} className="rounded-full border border-border bg-background px-2.5 py-1 text-mutedForeground">
                    {target === "SHIPMENT_RATE_QUOTE" ? "Shipment Rate Quote" : "Prospect Quote Generator"}
                  </span>
                ))}
                <span className="rounded-full border border-border bg-background px-2.5 py-1 text-mutedForeground">
                  {source.status}
                </span>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-6 grid gap-4 xl:grid-cols-2">
          <form action={createUpsQuoteSourceAction} className="rounded-md border border-border bg-background p-4">
            <h3 className="text-sm font-semibold text-foreground">Add UPS account</h3>
            <p className="mt-1 text-sm text-mutedForeground">
              Create or update a UPS source by shipper number. If it matches your local UPS credentials file, it will become live in the quote tools automatically.
            </p>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <Field label="Display name" name="displayName" placeholder="Charlotte Main UPS" />
              <Field label="Shipper number" name="shipperNumber" placeholder="G460D6" />
              <SelectField
                label="Country"
                name="countryCode"
                options={[
                  { value: "US", label: "United States" },
                  { value: "CA", label: "Canada" }
                ]}
              />
              <SelectField
                label="Status"
                name="status"
                options={[
                  { value: "ACTIVE", label: "Active" },
                  { value: "DISABLED", label: "Disabled" },
                  { value: "ERROR", label: "Error" }
                ]}
              />
              <Field label="Origin postal code" name="originPostalCode" placeholder="28273" />
              <Field label="Origin label" name="originLabel" placeholder="Charlotte, NC" />
              <Field label="Origin state / province" name="originStateProvince" placeholder="NC" />
              <SelectField
                label="Runtime mode"
                name="dryRun"
                options={[
                  { value: "false", label: "Live-ready" },
                  { value: "true", label: "Dry run" }
                ]}
              />
            </div>
            <div className="mt-4 flex flex-wrap gap-4 text-sm text-foreground">
              <label className="flex items-center gap-2">
                <input type="checkbox" name="toolTargets" value="SHIPMENT_RATE_QUOTE" defaultChecked />
                Shipment Rate Quote
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" name="toolTargets" value="PROSPECT_QUOTE" defaultChecked />
                Prospect Quote Generator
              </label>
            </div>
            <button className="mt-4 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primaryForeground transition-colors hover:bg-primaryHover">
              Save UPS source
            </button>
          </form>

          <form action={createCarrierPlaceholderAction} className="rounded-md border border-border bg-background p-4">
            <h3 className="text-sm font-semibold text-foreground">Stage future carrier</h3>
            <p className="mt-1 text-sm text-mutedForeground">
              Add FedEx, DHL, USPS, or any other planned carrier now so operations can see the target source in the quote workflow before we connect its pricing engine.
            </p>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <Field label="Display name" name="displayName" placeholder="FedEx Priority Account" />
              <Field label="Carrier name" name="carrierName" placeholder="FedEx" />
              <Field label="Carrier code" name="carrierCode" placeholder="FDX" />
              <SelectField
                label="Status"
                name="status"
                options={[
                  { value: "ACTIVE", label: "Active" },
                  { value: "DISABLED", label: "Disabled" },
                  { value: "ERROR", label: "Error" }
                ]}
              />
            </div>
            <label className="mt-3 block space-y-1 text-sm font-medium text-foreground">
              <span>Notes</span>
              <textarea
                name="notes"
                rows={4}
                placeholder="API owner, account notes, connection status, access requirements..."
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
              />
            </label>
            <div className="mt-4 flex flex-wrap gap-4 text-sm text-foreground">
              <label className="flex items-center gap-2">
                <input type="checkbox" name="toolTargets" value="SHIPMENT_RATE_QUOTE" defaultChecked />
                Shipment Rate Quote
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" name="toolTargets" value="PROSPECT_QUOTE" defaultChecked />
                Prospect Quote Generator
              </label>
            </div>
            <button className="mt-4 rounded-md border border-border px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted">
              Add planned carrier
            </button>
          </form>
        </div>
      </section>

      <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-foreground">UPS Accounts</h2>
            <p className="mt-1 text-sm leading-6 text-mutedForeground">
              Tenant-scoped account records used by the UPS tools module. Current seed data is dry-run only and keeps live credentials out of the app surface.
            </p>
          </div>
          <span className="rounded-full border border-warning/25 bg-warning/10 px-2.5 py-1 text-xs font-semibold text-warning">
            {settings.upsAccounts.length.toLocaleString("en-US")} configured
          </span>
        </div>

        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {settings.upsAccounts.map((account) => (
            <div key={account.id} className="rounded-md border border-border bg-muted/40 p-3">
              <div className="flex items-center justify-between gap-3">
                <p className="font-medium text-foreground">{account.name}</p>
                <span className="rounded-full border border-accentBorder bg-accentSoft px-2.5 py-1 text-xs font-semibold text-primary">
                  {account.dryRun ? "Dry run" : "Live-ready"}
                </span>
              </div>
              <p className="mt-2 text-sm text-mutedForeground">
                {account.originLabel} ({account.originPostalCode}) • {account.countryCode} • {account.shipperNumber}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-foreground">7L Accounts</h2>
            <p className="mt-1 text-sm leading-6 text-mutedForeground">
              Tenant-scoped 7L account records for the LTL Rate Portal. Sync the live carrier directory from 7L, then choose which carriers should be included in bulk pulls for this tenant.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="rounded-full border border-warning/25 bg-warning/10 px-2.5 py-1 text-xs font-semibold text-warning">
              {settings.sevenLAccounts.length.toLocaleString("en-US")} configured
            </span>
          </div>
        </div>

        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {settings.sevenLAccounts.map((account) => (
            <div key={account.id} className="rounded-md border border-border bg-muted/40 p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-medium text-foreground">{account.name}</p>
                  <p className="mt-2 text-sm text-mutedForeground">
                    {account.carriers.length} carriers • {account.carriers.filter((carrier) => carrier.enabled).length} enabled • {account.defaultUom} UOM • {account.harmonizedCharges ? "harmonized charges" : "base charges"}
                  </p>
                </div>
                <span className="rounded-full border border-accentBorder bg-accentSoft px-2.5 py-1 text-xs font-semibold text-primary">
                  {account.secretConfigured ? "Local runtime ready" : account.dryRun ? "Dry run" : "Live-ready"}
                </span>
              </div>

              <form action={syncSevenLCarriersAction} className="mt-4">
                <input type="hidden" name="accountId" value={account.id} />
                <button className="rounded-md border border-border px-3 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted">
                  Sync 7L carriers
                </button>
              </form>

              <form action={updateSevenLCarrierSelectionAction} className="mt-4 space-y-3">
                <input type="hidden" name="accountId" value={account.id} />
                <div className="max-h-72 space-y-2 overflow-y-auto rounded-md border border-border bg-background p-3">
                  {account.carriers.map((carrier) => (
                    <label key={carrier.carrierHash} className="flex items-start gap-3 text-sm text-foreground">
                      <input
                        type="checkbox"
                        name="enabledCarrierHash"
                        value={carrier.carrierHash}
                        defaultChecked={carrier.enabled}
                        className="mt-1"
                      />
                      <span>
                        <span className="font-medium text-foreground">{carrier.name}</span>
                        <span className="block text-xs text-mutedForeground">
                          {carrier.code} • {carrier.scac} {carrier.defaulted ? "• default account carrier" : ""}
                        </span>
                      </span>
                    </label>
                  ))}
                  {account.carriers.length === 0 ? (
                    <p className="text-sm text-mutedForeground">
                      No carrier directory is loaded yet. Sync this account against 7L to import your carrier list.
                    </p>
                  ) : null}
                </div>
                <button className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primaryForeground transition-colors hover:bg-primaryHover">
                  Save enabled carriers
                </button>
              </form>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function Field({
  label,
  name,
  defaultValue,
  placeholder
}: {
  label: string;
  name: string;
  defaultValue?: string;
  placeholder?: string;
}) {
  return (
    <label className="space-y-1 text-sm font-medium text-foreground">
      <span>{label}</span>
      <input
        required
        name={name}
        defaultValue={defaultValue}
        placeholder={placeholder}
        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
      />
    </label>
  );
}

function buildInviteMailto({
  email,
  role,
  loginUrl
}: {
  email: string;
  role: string;
  loginUrl: string;
}) {
  const subject = "Newl Apps access";
  const body = [
    "You have been given access to Newl Apps.",
    "",
    `Role: ${role}`,
    `Sign in: ${loginUrl}`,
    "",
    "Use your Newl Microsoft account when prompted."
  ].join("\n");

  return `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

function OptionalField({
  label,
  name,
  defaultValue,
  placeholder,
  info
}: {
  label: string;
  name: string;
  defaultValue?: string;
  placeholder?: string;
  info?: string;
}) {
  return (
    <label className="space-y-1 text-sm font-medium text-foreground">
      <FieldLabel label={label} info={info} />
      <input
        name={name}
        defaultValue={defaultValue}
        placeholder={placeholder}
        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
      />
    </label>
  );
}

function NumberField({
  label,
  name,
  defaultValue,
  min,
  max,
  info
}: {
  label: string;
  name: string;
  defaultValue?: number;
  min?: number;
  max?: number;
  info?: string;
}) {
  return (
    <label className="space-y-1 text-sm font-medium text-foreground">
      <FieldLabel label={label} info={info} />
      <input
        required
        type="number"
        name={name}
        defaultValue={defaultValue}
        min={min}
        max={max}
        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
      />
    </label>
  );
}

function DecimalField({
  label,
  name,
  defaultValue,
  placeholder,
  info
}: {
  label: string;
  name: string;
  defaultValue?: string | null;
  placeholder?: string;
  info?: string;
}) {
  return (
    <label className="space-y-1 text-sm font-medium text-foreground">
      <FieldLabel label={label} info={info} />
      <input
        type="number"
        step="0.01"
        min={0}
        name={name}
        defaultValue={defaultValue ?? ""}
        placeholder={placeholder}
        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
      />
    </label>
  );
}

function TextAreaField({
  label,
  name,
  defaultValue,
  description,
  info
}: {
  label: string;
  name: string;
  defaultValue?: string;
  description?: string;
  info?: string;
}) {
  return (
    <label className="space-y-1 text-sm font-medium text-foreground">
      <FieldLabel label={label} info={info} />
      <textarea
        name={name}
        rows={5}
        defaultValue={defaultValue}
        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
      />
      {description ? <span className="block text-xs font-normal text-mutedForeground">{description}</span> : null}
    </label>
  );
}

function FieldLabel({ label, info }: { label: string; info?: string }) {
  return (
    <span className="flex items-center gap-2">
      <span>{label}</span>
      {info ? <InfoHint text={info} /> : null}
    </span>
  );
}

function SummaryCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-md border border-border bg-card p-3">
      <p className="text-sm font-semibold text-foreground">{title}</p>
      <p className="mt-2 text-sm leading-6 text-mutedForeground">{body}</p>
    </div>
  );
}

function formatLaneSummary(settings: {
  preferredOriginCountries: string[];
  penalizedOriginCountries: string[];
  preferredOriginPorts: string[];
  penalizedOriginPorts: string[];
  preferredDestinationMarkets: string[];
  penalizedDestinationMarkets: string[];
}) {
  const parts = [
    summarizePreference("Preferred origin countries", settings.preferredOriginCountries),
    summarizePreference("Deprioritized origin countries", settings.penalizedOriginCountries),
    summarizePreference("Preferred origin ports", settings.preferredOriginPorts),
    summarizePreference("Deprioritized origin ports", settings.penalizedOriginPorts),
    summarizePreference("Preferred destination markets", settings.preferredDestinationMarkets),
    summarizePreference("Deprioritized destination markets", settings.penalizedDestinationMarkets)
  ].filter(Boolean);

  return parts.length > 0
    ? parts.join(". ") + "."
    : "No additional lane bias is configured beyond the TradeMining search profile itself.";
}

function formatIndustrySummary(settings: {
  preferredIndustryKeywords: string[];
  penalizedIndustryKeywords: string[];
  preferredHsCodePrefixes: string[];
  penalizedHsCodePrefixes: string[];
}) {
  const parts = [
    summarizePreference("Preferred keywords", settings.preferredIndustryKeywords),
    summarizePreference("Deprioritized keywords", settings.penalizedIndustryKeywords),
    summarizePreference("Preferred HS prefixes", settings.preferredHsCodePrefixes),
    summarizePreference("Deprioritized HS prefixes", settings.penalizedHsCodePrefixes)
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(". ") + "." : "No industry-specific bias is configured yet.";
}

function formatCompanySizeSummary(settings: {
  midMarketTeuMin: string | null;
  midMarketTeuMax: string | null;
  midMarketBoost: number;
  oversizeTeuThreshold: string | null;
  oversizeShipmentCount30dThreshold: number | null;
  oversizePenalty: number;
}) {
  const midMarket =
    settings.midMarketTeuMin && settings.midMarketTeuMax
      ? `Mid-market importers between ${settings.midMarketTeuMin} and ${settings.midMarketTeuMax} TEU receive a ${settings.midMarketBoost}-point boost`
      : "No mid-market TEU range is currently configured";
  const oversize =
    settings.oversizeTeuThreshold || settings.oversizeShipmentCount30dThreshold
      ? `oversize companies above ${settings.oversizeTeuThreshold ?? "n/a"} TEU or ${settings.oversizeShipmentCount30dThreshold ?? "n/a"} recent shipments lose ${settings.oversizePenalty} points`
      : "no oversize penalty is currently configured";

  return `${midMarket}, and ${oversize}.`;
}

function formatContactScoringSummary(settings: {
  contactDecisionMakerWeight: number;
  contactManagerWeight: number;
  contactLogisticsDepartmentWeight: number;
  contactWeakFunctionPenalty: number;
  contactCompanyContextWeight: number;
  contactTier1Threshold: number;
  contactTier2Threshold: number;
  contactTier3Threshold: number;
  preferredContactDepartments: string[];
}) {
  const departmentPreview =
    settings.preferredContactDepartments.length > 0
      ? settings.preferredContactDepartments.slice(0, 3).join(", ")
      : "no preferred functions";

  return `Decision-maker titles add ${settings.contactDecisionMakerWeight} points, manager titles add ${settings.contactManagerWeight}, preferred functions add ${settings.contactLogisticsDepartmentWeight}, and account quality can add up to ${settings.contactCompanyContextWeight} more based on the company score. Weak-function roles lose ${settings.contactWeakFunctionPenalty}. Tier thresholds are ${settings.contactTier1Threshold}/${settings.contactTier2Threshold}/${settings.contactTier3Threshold}, with current emphasis on ${departmentPreview}.`;
}

function summarizePreference(label: string, values: string[]) {
  if (values.length === 0) {
    return "";
  }

  const preview = values.slice(0, 4).join(", ");
  const overflow = values.length > 4 ? ` +${values.length - 4} more` : "";
  return `${label}: ${preview}${overflow}`;
}

function ApolloCadenceMappingTable({
  entries,
  options
}: {
  entries: Array<{
    tier: string;
    label: string;
    apolloSequenceId: string | null;
    automationMode: string;
    requiresAiDraft: boolean;
    requiresRepAssignment: boolean;
    notes: string | null;
  }>;
  options: Array<{
    id: string;
    name: string;
  }>;
}) {
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="min-w-full divide-y divide-border text-sm">
        <thead className="bg-muted text-left text-xs font-semibold uppercase text-mutedForeground">
          <tr>
            <th className="px-3 py-3">Tier</th>
            <th className="px-3 py-3">Apollo cadence</th>
            <th className="px-3 py-3">Automation mode</th>
            <th className="px-3 py-3">Requirements</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border bg-background">
          {entries.map((entry) => (
            <tr key={entry.tier}>
              <td className="px-3 py-3 align-top">
                <input type="hidden" name="apolloSequenceTier" value={entry.tier} />
                <input type="hidden" name="apolloSequenceLabel" value={entry.label} />
                <div className="space-y-1">
                  <p className="font-medium text-foreground">{entry.label}</p>
                  <p className="text-xs text-mutedForeground">{formatTier(entry.tier)}</p>
                </div>
              </td>
              <td className="px-3 py-3 align-top">
                <select
                  name="apolloSequenceId"
                  defaultValue={entry.apolloSequenceId ?? ""}
                  className="w-full min-w-72 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
                >
                  <option value="">No cadence mapped</option>
                  {options.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.name}
                    </option>
                  ))}
                </select>
                <p className="mt-2 text-xs text-mutedForeground">
                  Contacts in this tier will recommend the mapped cadence by default.
                </p>
              </td>
              <td className="px-3 py-3 align-top">
                <div className="space-y-2">
                  <span className="rounded-full border border-border bg-muted/40 px-2.5 py-1 text-xs font-semibold text-foreground">
                    {formatAutomationMode(entry.automationMode)}
                  </span>
                  <p className="text-xs leading-5 text-mutedForeground">
                    {entry.automationMode === "AI_CUSTOM"
                      ? "Best for tiers where Newl Apps should prepare a custom outbound draft before the cadence is used."
                      : entry.automationMode === "APOLLO_AI"
                        ? "Best for tiers where Apollo AI personalization can carry most of the outreach."
                        : "Best for lighter-touch email-only outreach without deeper personalization by default."}
                  </p>
                </div>
              </td>
              <td className="px-3 py-3 align-top">
                <div className="space-y-2 text-xs leading-5 text-mutedForeground">
                  <p>{entry.requiresRepAssignment ? "Requires a mapped Apollo rep assignment before queueing." : "Rep assignment optional."}</p>
                  <label className="flex items-start gap-2 rounded-md border border-border bg-card px-3 py-2 text-xs text-foreground">
                    <input
                      type="checkbox"
                      name="apolloSequenceRequiresAiDraft"
                      value={entry.tier}
                      defaultChecked={entry.requiresAiDraft}
                      className="mt-0.5"
                    />
                    <span>
                      <span className="block font-medium">Require AI subject + email draft</span>
                      <span className="mt-1 block text-mutedForeground">
                        Turn this on when this tier should wait for a Newl Apps draft before any future Apollo sequence push.
                      </span>
                    </span>
                  </label>
                  {entry.notes ? <p>{entry.notes}</p> : null}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatTier(value: string) {
  return value.replaceAll("_", " ");
}

function formatAutomationMode(value: string) {
  if (value === "AI_CUSTOM") {
    return "AI custom draft";
  }

  if (value === "APOLLO_AI") {
    return "Apollo AI";
  }

  return "Email only";
}

function buildApolloRepRows(
  entries: Array<{
    id: string;
    sequenceOwnerName: string;
    apolloUserId: string | null;
    sendFromEmail: string | null;
    sendFromEmailAccountId: string | null;
    active: boolean;
  }>
) {
  return entries;
}

function SelectField({
  label,
  name,
  defaultValue,
  options
}: {
  label: string;
  name: string;
  defaultValue?: string;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <label className="space-y-1 text-sm font-medium text-foreground">
      <span>{label}</span>
      <select
        required
        name={name}
        defaultValue={defaultValue}
        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
