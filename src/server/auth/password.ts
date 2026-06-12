import bcrypt from "bcryptjs";

// Password hashing helpers. These exist ONLY to support the dev-only local
// credentials login path and local seed data. Production authentication uses
// Microsoft Entra ID SSO and never relies on a stored password.

const SALT_ROUNDS = 10;

export async function hashPassword(plainPassword: string): Promise<string> {
  return bcrypt.hash(plainPassword, SALT_ROUNDS);
}

export async function verifyPassword(plainPassword: string, passwordHash: string): Promise<boolean> {
  return bcrypt.compare(plainPassword, passwordHash);
}
