import { readFile, stat } from "node:fs/promises";

import { describe, expect, it, vi } from "vitest";

import {
  decodeDirectoryCredentialMaster,
  deriveDirectoryPassword,
  fillProtectedDirectoryCredentials
} from "../ops/openclaw/plugins/newl-website-growth/src/directory-credentials";
import {
  buildDirectoryCredentialRef,
  findWebsiteGrowthDirectoryVerificationLink
} from "@/modules/website-growth/directory-accounts";

const master = Buffer.alloc(32, 7).toString("base64");

describe("directory credential derivation", () => {
  it("is stable for one account and unique across directories", () => {
    const base = {
      master,
      credentialRef: "directory:v1:opportunity-1",
      username: "partnerships@newlgroup.com",
      version: 1
    };
    const first = deriveDirectoryPassword({
      ...base,
      sourceOrigin: "https://directory-a.example"
    });
    const repeat = deriveDirectoryPassword({
      ...base,
      sourceOrigin: "https://directory-a.example/register"
    });
    const second = deriveDirectoryPassword({
      ...base,
      sourceOrigin: "https://directory-b.example"
    });

    expect(first).toBe(repeat);
    expect(first).not.toBe(second);
    expect(first).toHaveLength(28);
    expect(first).toMatch(/[A-Z]/);
    expect(first).toMatch(/[a-z]/);
    expect(first).toMatch(/[0-9]/);
    expect(first).toMatch(/[!@#%_-]/);
  });

  it("refuses a weak master secret", () => {
    expect(() => decodeDirectoryCredentialMaster("too-short")).toThrow(
      "at least 32 random bytes"
    );
  });

  it("uses a stable opaque Newl Apps credential reference", () => {
    const reference = buildDirectoryCredentialRef({
      tenantId: "tenant-1",
      opportunityId: "opportunity-1",
      sourceOrigin: "https://directory.example/register"
    });

    expect(reference).toMatch(/^directory:v1:[a-f0-9]{32}$/);
    expect(reference).not.toContain("tenant-1");
    expect(reference).not.toContain("opportunity-1");
  });
});

describe("directory verification email matching", () => {
  it("returns only a same-organization HTTPS activation link", () => {
    const result = findWebsiteGrowthDirectoryVerificationLink({
      username: "partnerships@newlgroup.com",
      sourceDomain: "directory.example",
      requestedAt: new Date("2026-07-27T12:00:00.000Z"),
      message: {
        id: "message-1",
        subject: "Verify your directory account",
        receivedDateTime: "2026-07-27T12:05:00.000Z",
        toRecipients: [{
          emailAddress: {
            address: "partnerships@newlgroup.com"
          }
        }],
        from: {
          emailAddress: {
            address: "accounts@directory.example"
          }
        },
        body: {
          contentType: "html",
          content:
            '<a href="https://accounts.directory.example/activate?token=private">Verify</a>'
        }
      }
    });

    expect(result).toEqual({
      verificationUrl:
        "https://accounts.directory.example/activate?token=private",
      messageFingerprint: expect.stringMatching(/^[a-f0-9]{24}$/)
    });
  });

  it("refuses unrelated verification links and wrong recipients", () => {
    const baseMessage = {
      id: "message-2",
      subject: "Verify your account",
      receivedDateTime: "2026-07-27T12:05:00.000Z",
      from: {
        emailAddress: {
          address: "alerts@unrelated.example"
        }
      },
      body: {
        contentType: "html",
        content:
          '<a href="https://malicious.example/activate?token=private">Verify</a>'
      }
    };
    expect(findWebsiteGrowthDirectoryVerificationLink({
      username: "partnerships@newlgroup.com",
      sourceDomain: "directory.example",
      requestedAt: new Date("2026-07-27T12:00:00.000Z"),
      message: {
        ...baseMessage,
        toRecipients: [{
          emailAddress: {
            address: "partnerships@newlgroup.com"
          }
        }]
      }
    })).toBeNull();
    expect(findWebsiteGrowthDirectoryVerificationLink({
      username: "partnerships@newlgroup.com",
      sourceDomain: "directory.example",
      requestedAt: new Date("2026-07-27T12:00:00.000Z"),
      message: {
        ...baseMessage,
        from: {
          emailAddress: {
            address: "accounts@directory.example"
          }
        },
        toRecipients: [{
          emailAddress: {
            address: "someone-else@newlgroup.com"
          }
        }]
      }
    })).toBeNull();
  });
});

describe("protected directory credential fill", () => {
  it("passes secrets through a private fields file and returns no password", async () => {
    const runCommand = vi.fn(async (
      _command: string,
      args: string[],
      options: {
        env: NodeJS.ProcessEnv;
      }
    ) => {
      const fieldsPath = args[args.indexOf("--fields-file") + 1];
      const mode = (await stat(fieldsPath)).mode & 0o777;
      const fields = JSON.parse(await readFile(fieldsPath, "utf8"));
      expect(mode).toBe(0o600);
      expect(fields).toEqual([
        { ref: "user-ref", value: "partnerships@newlgroup.com" },
        { ref: "password-ref", value: expect.any(String) },
        { ref: "confirm-ref", value: expect.any(String) }
      ]);
      expect(fields[1].value).toBe(fields[2].value);
      expect(options.env.NEWL_DIRECTORY_PASSWORD_MASTER_V1).toBeUndefined();
      return { stdout: "ok", stderr: "" };
    });
    const result = await fillProtectedDirectoryCredentials({
      input: {
        opportunityId: "opportunity-1",
        targetId: "target-1",
        usernameRef: "user-ref",
        passwordRef: "password-ref",
        confirmPasswordRef: "confirm-ref"
      },
      context: {
        opportunityId: "opportunity-1",
        credentialRef: "directory:v1:opportunity-1",
        sourceOrigin: "https://directory.example",
        username: "partnerships@newlgroup.com",
        version: 1
      },
      env: {
        NODE_ENV: "test",
        NEWL_DIRECTORY_PASSWORD_MASTER_V1: master
      },
      runCommand
    });

    expect(result).toEqual({
      filled: true,
      opportunityId: "opportunity-1",
      credentialRef: "directory:v1:opportunity-1",
      version: 1,
      username: "partnerships@newlgroup.com"
    });
    expect(JSON.stringify(result)).not.toContain(
      deriveDirectoryPassword({
        master,
        credentialRef: "directory:v1:opportunity-1",
        sourceOrigin: "https://directory.example",
        username: "partnerships@newlgroup.com",
        version: 1
      })
    );
  });
});
