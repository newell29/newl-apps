import { IntegrationProvider, IntegrationStatus } from "@prisma/client";

import {
  buildMicrosoftGraphConfig,
  DEFAULT_MICROSOFT_GRAPH_SCOPES,
  parseMicrosoftGraphSettings,
  type MicrosoftGraphSettings
} from "@/server/integrations/microsoft-graph";
import {
  buildOceanFreightAutomationConfig,
  DEFAULT_OCEAN_FREIGHT_AUTOMATION_SETTINGS,
  type OceanFreightAutomationSettings
} from "@/modules/ocean-freight-pricing/automation-settings";

export const OCEAN_FREIGHT_MICROSOFT_GRAPH_CREDENTIAL_NAME = "Microsoft 365 Ocean Freight Pricing";

export type OceanFreightMicrosoftGraphSettings = MicrosoftGraphSettings;

export function parseOceanFreightMicrosoftGraphSettings(
  credential?: {
    provider: IntegrationProvider;
    status: IntegrationStatus;
    publicConfig: unknown;
  } | null
): OceanFreightMicrosoftGraphSettings {
  return parseMicrosoftGraphSettings(credential);
}

export function buildOceanFreightMicrosoftGraphConfig(input: {
  adminMailboxTargets: string[];
  mailLookbackDays: number;
  maxMailMessagesPerMailbox: number;
  mailSyncEnabled: boolean;
  automationSettings?: OceanFreightAutomationSettings;
}) {
  return {
    ...buildMicrosoftGraphConfig({
    scopes: DEFAULT_MICROSOFT_GRAPH_SCOPES,
    adminMailboxTargets: input.adminMailboxTargets,
    mailboxAccessMode: "ADMIN_SELECTED_MAILBOXES",
    mailLookbackDays: input.mailLookbackDays,
    maxMailMessagesPerMailbox: input.maxMailMessagesPerMailbox,
    mailSyncEnabled: input.mailSyncEnabled,
    fileSyncEnabled: false,
    draftingEnabled: false
    }),
    ...buildOceanFreightAutomationConfig(input.automationSettings ?? DEFAULT_OCEAN_FREIGHT_AUTOMATION_SETTINGS)
  };
}
