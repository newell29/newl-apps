export function normalizeHunterCompanyKey(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function normalizeHunterCompanyIdentity(value: string) {
  return normalizeHunterCompanyKey(
    value.replace(
      /\b(incorporated|inc|llc|ltd|limited|corp|corporation|co|company|sa|s\.a|plc|gmbh)\b/gi,
      " "
    )
  );
}
