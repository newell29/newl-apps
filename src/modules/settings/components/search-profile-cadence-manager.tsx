"use client";

import { useMemo, useState } from "react";
import {
  clearSearchProfileApolloSequenceMappingAction,
  copySearchProfileApolloSequenceMappingAction,
  saveSearchProfileApolloSequenceMappingAction
} from "@/modules/settings/actions";
import type { SearchProfileCadenceMappingEntry } from "@/modules/settings/types";

export function SearchProfileCadenceManager({
  profiles,
  options
}: {
  profiles: SearchProfileCadenceMappingEntry[];
  options: Array<{
    id: string;
    name: string;
  }>;
}) {
  const [selectedProfileId, setSelectedProfileId] = useState(profiles[0]?.profileId ?? "");

  const selectedProfile = useMemo(
    () => profiles.find((profile) => profile.profileId === selectedProfileId) ?? profiles[0] ?? null,
    [profiles, selectedProfileId]
  );

  if (!selectedProfile) {
    return (
      <div className="mt-4 rounded-lg border border-border bg-background p-4 text-sm text-mutedForeground">
        No TradeMining search profiles are available yet.
      </div>
    );
  }

  const copyCandidates = profiles.filter((candidate) => candidate.profileId !== selectedProfile.profileId);

  return (
    <div className="mt-4 space-y-4">
      <div className="rounded-lg border border-border bg-background p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="min-w-[260px] flex-1 space-y-1 text-sm font-medium text-foreground">
            <span>Search profile</span>
            <select
              value={selectedProfile.profileId}
              onChange={(event) => setSelectedProfileId(event.target.value)}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
            >
              {profiles.map((profile) => (
                <option key={profile.profileId} value={profile.profileId}>
                  {profile.profileName}
                </option>
              ))}
            </select>
          </label>
          <div className="flex flex-wrap items-center gap-2 pb-1">
            <span
              className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${
                selectedProfile.profileEnabled
                  ? "border-success/25 bg-success/10 text-success"
                  : "border-border bg-muted text-mutedForeground"
              }`}
            >
              {selectedProfile.profileEnabled ? "Enabled" : "Disabled"}
            </span>
            <span
              className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${
                selectedProfile.usesDefaultMapping
                  ? "border-border bg-muted text-mutedForeground"
                  : "border-accentBorder bg-accentSoft text-primary"
              }`}
            >
              {selectedProfile.usesDefaultMapping ? "Using default mapping" : "Profile-specific override"}
            </span>
          </div>
        </div>

        <p className="mt-3 text-sm text-mutedForeground">
          {selectedProfile.destinationMarkets.length > 0
            ? `Destination focus: ${selectedProfile.destinationMarkets.join(", ")}`
            : "No destination markets listed yet."}
        </p>
      </div>

      <article className="rounded-lg border border-border bg-background p-4">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
          <div>
            <h3 className="text-sm font-semibold text-foreground">{selectedProfile.profileName}</h3>
            <p className="mt-1 text-xs leading-5 text-mutedForeground">
              Adjust cadence behavior for this TradeMining profile without affecting the tenant-wide default.
            </p>
          </div>

          <form action={copySearchProfileApolloSequenceMappingAction} className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="targetProfileId" value={selectedProfile.profileId} />
            <select
              name="sourceProfileId"
              defaultValue=""
              className="min-w-56 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
              disabled={copyCandidates.length === 0}
            >
              <option value="" disabled>
                {copyCandidates.length === 0 ? "No other profiles to copy" : "Copy cadence from profile"}
              </option>
              {copyCandidates.map((candidate) => (
                <option key={candidate.profileId} value={candidate.profileId}>
                  {candidate.profileName}
                </option>
              ))}
            </select>
            <button
              disabled={copyCandidates.length === 0}
              className="rounded-md border border-border px-3 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
            >
              Copy mapping
            </button>
          </form>
        </div>

        <form action={saveSearchProfileApolloSequenceMappingAction} className="mt-4 space-y-4">
          <input type="hidden" name="profileId" value={selectedProfile.profileId} />
          <ApolloCadenceMappingTable entries={selectedProfile.sequenceMapping} options={options} />

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-mutedForeground">
              If this profile is left on the default structure, contacts from it will inherit the tenant-wide cadence setup above.
            </p>
            <button className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primaryForeground transition-colors hover:bg-primaryHover">
              Save profile cadence
            </button>
          </div>
        </form>

        {!selectedProfile.usesDefaultMapping ? (
          <form action={clearSearchProfileApolloSequenceMappingAction} className="mt-3">
            <input type="hidden" name="profileId" value={selectedProfile.profileId} />
            <button className="rounded-md border border-border px-3 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted">
              Revert to default mapping
            </button>
          </form>
        ) : null}
      </article>
    </div>
  );
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
