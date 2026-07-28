import { describe, expect, it } from "vitest";

import { resolveLiveApolloSequence } from "@/modules/lead-gen/apollo-sequence-resolution";
import type { ApolloSequenceDirectoryEntry } from "@/server/integrations/apollo";

describe("resolveLiveApolloSequence", () => {
  it("converts the internal Hunter executive key to the live Apollo sequence ID", () => {
    expect(
      resolveLiveApolloSequence({
        requestedSequence: {
          id: "hunter-executive-referral",
          name: "Hunter - Executive Referral"
        },
        directory: [
          sequence({
            id: "66a1234567890abcdef12345",
            name: "Hunter - Executive Referral"
          })
        ]
      })
    ).toEqual({
      ok: true,
      sequence: {
        id: "66a1234567890abcdef12345",
        name: "Hunter - Executive Referral"
      },
      resolvedBy: "NAME"
    });
  });

  it("preserves a verified live Apollo sequence ID", () => {
    expect(
      resolveLiveApolloSequence({
        requestedSequence: {
          id: "66a1234567890abcdef12345",
          name: "Hunter - Executive Referral"
        },
        directory: [
          sequence({
            id: "66a1234567890abcdef12345",
            name: "Hunter - Executive Referral"
          })
        ]
      })
    ).toEqual({
      ok: true,
      sequence: {
        id: "66a1234567890abcdef12345",
        name: "Hunter - Executive Referral"
      },
      resolvedBy: "ID"
    });
  });

  it("resolves a stale internal ID by a unique normalized cadence name", () => {
    expect(
      resolveLiveApolloSequence({
        requestedSequence: {
          id: "stale-local-key",
          name: "  HUNTER   -   EMAIL ONLY "
        },
        directory: [
          sequence({
            id: "66b1234567890abcdef12345",
            name: "Hunter - Email Only"
          })
        ]
      })
    ).toMatchObject({
      ok: true,
      sequence: {
        id: "66b1234567890abcdef12345"
      },
      resolvedBy: "NAME"
    });
  });

  it("fails closed when the requested cadence is absent or inactive", () => {
    expect(
      resolveLiveApolloSequence({
        requestedSequence: {
          id: "hunter-executive-referral",
          name: "Hunter - Executive Referral"
        },
        directory: [
          sequence({
            id: "66a1234567890abcdef12345",
            name: "Hunter - Executive Referral",
            active: false
          })
        ]
      })
    ).toEqual({
      ok: false,
      reason:
        'The selected cadence "Hunter - Executive Referral" is not active in Apollo. ' +
        "Sync Apollo cadences in Settings, select an active cadence, and retry this approved contact."
    });
  });

  it("fails closed when duplicate active cadence names make the mapping ambiguous", () => {
    expect(
      resolveLiveApolloSequence({
        requestedSequence: {
          id: "hunter-executive-referral",
          name: "Hunter - Executive Referral"
        },
        directory: [
          sequence({ id: "sequence-a", name: "Hunter - Executive Referral" }),
          sequence({ id: "sequence-b", name: "Hunter - Executive Referral" })
        ]
      })
    ).toEqual({
      ok: false,
      reason:
        'Apollo has multiple active cadences named "Hunter - Executive Referral". ' +
        "Archive or rename the duplicate before retrying this approved contact."
    });
  });
});

function sequence(
  overrides: Partial<ApolloSequenceDirectoryEntry>
): ApolloSequenceDirectoryEntry {
  return {
    id: "apollo-sequence",
    name: "Apollo Sequence",
    active: true,
    archived: false,
    description: null,
    lastUsedAt: null,
    ...overrides
  };
}
