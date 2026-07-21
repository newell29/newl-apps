import type { AuthenticatedContext } from "@/server/tenant-context";

export const TEAMSHIP_INTERNAL_READ_USERS = [
  {
    name: "Alex Newell",
    emails: ["alex.newell@newl.ca", "alex@newl.ca", "alex@newlgroup.com"]
  },
  {
    name: "Faisal Haroon",
    emails: []
  },
  {
    name: "Suzy Boreham",
    emails: ["suzy.boreham@newlgroup.com"]
  },
  {
    name: "Lily Morales",
    emails: ["lily.morales@newl.ca"]
  }
] as const;

export function hasTeamshipInternalReadAccess(
  context: Pick<AuthenticatedContext, "userEmail" | "userName">
) {
  const name = normalizeIdentity(context.userName);
  const email = normalizeIdentity(context.userEmail);

  return TEAMSHIP_INTERNAL_READ_USERS.some(
    (user) =>
      normalizeIdentity(user.name) === name ||
      user.emails.some((candidate) => normalizeIdentity(candidate) === email)
  );
}

function normalizeIdentity(value: string | null) {
  return value?.trim().replace(/\s+/g, " ").toLowerCase() ?? "";
}
