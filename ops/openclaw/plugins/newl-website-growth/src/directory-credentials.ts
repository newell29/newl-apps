import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const PASSWORD_LENGTH = 28;
const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const LOWER = "abcdefghijkmnopqrstuvwxyz";
const DIGITS = "23456789";
const SYMBOLS = "!@#%_-";
const ALL = `${UPPER}${LOWER}${DIGITS}${SYMBOLS}`;

export type DirectoryCredentialContext = {
  opportunityId: string;
  credentialRef: string;
  sourceOrigin: string;
  username: string;
  version: 1;
};

export type DirectoryCredentialFillInput = {
  opportunityId: string;
  targetId: string;
  usernameRef: string;
  passwordRef: string;
  confirmPasswordRef: string;
};

type RunCommand = (
  command: string,
  args: string[],
  options: {
    env: NodeJS.ProcessEnv;
    maxBuffer: number;
  }
) => Promise<unknown>;

export function decodeDirectoryCredentialMaster(value: string | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new Error("The protected directory credential master is not configured.");
  }

  let decoded: Buffer;
  if (/^[a-f0-9]{64,}$/i.test(trimmed) && trimmed.length % 2 === 0) {
    decoded = Buffer.from(trimmed, "hex");
  } else if (/^[A-Za-z0-9+/]+={0,2}$/.test(trimmed)) {
    decoded = Buffer.from(trimmed, "base64");
  } else {
    decoded = Buffer.from(trimmed, "utf8");
  }
  if (decoded.length < 32) {
    throw new Error("The directory credential master must contain at least 32 random bytes.");
  }
  return decoded;
}

export function deriveDirectoryPassword({
  master,
  credentialRef,
  sourceOrigin,
  username,
  version
}: {
  master: Buffer | string;
  credentialRef: string;
  sourceOrigin: string;
  username: string;
  version: number;
}) {
  const key = Buffer.isBuffer(master)
    ? master
    : decodeDirectoryCredentialMaster(master);
  const normalizedOrigin = new URL(sourceOrigin).origin.toLowerCase();
  const normalizedUsername = username.trim().toLowerCase();
  const normalizedRef = credentialRef.trim();
  if (!normalizedRef || !normalizedUsername || version !== 1) {
    throw new Error("Directory credential context is incomplete or unsupported.");
  }

  const context = [
    "newl-directory-password",
    `v${version}`,
    normalizedRef,
    normalizedOrigin,
    normalizedUsername
  ].join("|");
  const digest = crypto.createHmac("sha256", key).update(context).digest();
  const characters = [
    pick(UPPER, digest[0]),
    pick(LOWER, digest[1]),
    pick(DIGITS, digest[2]),
    pick(SYMBOLS, digest[3])
  ];
  for (let index = characters.length; index < PASSWORD_LENGTH; index += 1) {
    characters.push(pick(ALL, digest[index % digest.length]));
  }

  const shuffle = crypto
    .createHmac("sha256", key)
    .update(`${context}|shuffle`)
    .digest();
  for (let index = characters.length - 1; index > 0; index -= 1) {
    const swapIndex = shuffle[index % shuffle.length] % (index + 1);
    [characters[index], characters[swapIndex]] = [
      characters[swapIndex],
      characters[index]
    ];
  }
  return characters.join("");
}

export async function fillProtectedDirectoryCredentials({
  input,
  context,
  env = process.env,
  runCommand = execFileAsync as RunCommand
}: {
  input: DirectoryCredentialFillInput;
  context: DirectoryCredentialContext;
  env?: NodeJS.ProcessEnv;
  runCommand?: RunCommand;
}) {
  if (context.opportunityId !== input.opportunityId) {
    throw new Error("The directory credential context does not match the approved opportunity.");
  }
  const master = decodeDirectoryCredentialMaster(
    env.NEWL_DIRECTORY_PASSWORD_MASTER_V1
  );
  const password = deriveDirectoryPassword({
    master,
    credentialRef: context.credentialRef,
    sourceOrigin: context.sourceOrigin,
    username: context.username,
    version: context.version
  });
  const fields = [
    { ref: input.usernameRef, value: context.username },
    { ref: input.passwordRef, value: password },
    { ref: input.confirmPasswordRef, value: password }
  ];
  const temporaryDirectory = await mkdtemp(
    path.join(os.tmpdir(), "newl-directory-credentials-")
  );
  const fieldsFile = path.join(temporaryDirectory, "fields.json");
  const browserEnvironment = { ...env };
  delete browserEnvironment.NEWL_DIRECTORY_PASSWORD_MASTER_V1;

  try {
    await chmod(temporaryDirectory, 0o700);
    await writeFile(fieldsFile, JSON.stringify(fields), {
      encoding: "utf8",
      mode: 0o600
    });
    await runCommand(
      "openclaw",
      [
        "browser",
        "--json",
        "fill",
        "--fields-file",
        fieldsFile,
        "--target-id",
        input.targetId
      ],
      {
        env: browserEnvironment,
        maxBuffer: 1024 * 1024
      }
    );
  } catch {
    throw new Error(
      "The protected directory credential fill failed. No credential value was logged."
    );
  } finally {
    master.fill(0);
    await rm(temporaryDirectory, { recursive: true, force: true });
  }

  return {
    filled: true,
    opportunityId: input.opportunityId,
    credentialRef: context.credentialRef,
    version: context.version,
    username: context.username
  };
}

function pick(alphabet: string, value: number) {
  return alphabet[value % alphabet.length];
}
