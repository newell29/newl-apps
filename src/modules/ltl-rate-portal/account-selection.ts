import type { SevenLAccountConfig } from "@/modules/ltl-rate-portal/types";

export function pickPreferredLiveSevenLAccount(accounts: SevenLAccountConfig[]) {
  return (
    accounts.find((account) => !account.dryRun && account.secretConfigured && account.status === "ACTIVE") ??
    accounts.find((account) => !account.dryRun && account.status === "ACTIVE") ??
    null
  );
}

export function pickPreferredSevenLAccount(accounts: SevenLAccountConfig[]) {
  return pickPreferredLiveSevenLAccount(accounts) ?? accounts.find((account) => account.status === "ACTIVE") ?? null;
}
