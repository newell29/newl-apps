import type { TeamshipReadScope } from "@/server/integrations/teamship-settings";

export type TeamshipScopeReferenceResolution = {
  customerId: string | null;
  warehouseId: string | null;
  warehouseChoices: string[];
};

export function resolveTeamshipScopeReference(
  prompt: string,
  scopes: readonly TeamshipReadScope[]
): TeamshipScopeReferenceResolution {
  const customer = resolveCustomer(prompt, scopes);
  if (!customer) {
    return { customerId: null, warehouseId: null, warehouseChoices: [] };
  }

  const customerScopes = scopes.filter((scope) => scope.customerId === customer.customerId);
  const warehouses = uniqueWarehouses(customerScopes);
  const warehouseWasNamed = /\bwarehouse(?:\s+id)?\s*[:#]?\s*[A-Za-z0-9._/-]+/i.test(prompt);
  const explicitWarehouseId = resolveConfiguredIdentifier(prompt, "warehouse", warehouses.map((warehouse) => warehouse.id));
  const namedWarehouseId = resolveNamedReference(
    prompt,
    warehouses.map((warehouse) => ({ id: warehouse.id, name: warehouse.name }))
  );
  const warehouseId = explicitWarehouseId ?? namedWarehouseId ??
    (!warehouseWasNamed && warehouses.length === 1 ? warehouses[0]?.id ?? null : null);

  return {
    customerId: customer.customerId,
    warehouseId,
    warehouseChoices: warehouses.map((warehouse) => warehouse.name).sort((left, right) => left.localeCompare(right))
  };
}

function resolveCustomer(prompt: string, scopes: readonly TeamshipReadScope[]) {
  const customers = uniqueCustomers(scopes);
  const explicitCustomerId = resolveConfiguredIdentifier(prompt, "customer", customers.map((customer) => customer.id));
  const namedCustomerId = resolveNamedReference(
    prompt,
    customers.map((customer) => ({ id: customer.id, name: customer.name }))
  );
  const customerId = explicitCustomerId ?? namedCustomerId;
  return customerId ? { customerId } : null;
}

function resolveConfiguredIdentifier(prompt: string, field: "customer" | "warehouse", configuredIds: string[]) {
  const match = prompt.match(new RegExp(`\\b${field}(?:\\s+id)?\\s*[:#]?\\s*([A-Za-z0-9._/-]+)`, "i"));
  const candidate = match?.[1]?.trim();
  if (!candidate) return null;
  return configuredIds.find((identifier) => normalizeWords(identifier) === normalizeWords(candidate)) ?? null;
}

function resolveNamedReference(prompt: string, references: Array<{ id: string; name: string }>) {
  const aliases = buildUniqueAliases(references);
  const normalizedPrompt = ` ${normalizeWords(prompt)} `;
  const matches = aliases
    .filter((alias) => normalizedPrompt.includes(` ${alias.value} `))
    .sort((left, right) => right.value.length - left.value.length);
  if (matches.length === 0) return null;

  const longestLength = matches[0]?.value.length ?? 0;
  const longestIds = new Set(matches.filter((match) => match.value.length === longestLength).map((match) => match.id));
  return longestIds.size === 1 ? [...longestIds][0] ?? null : null;
}

function buildUniqueAliases(references: Array<{ id: string; name: string }>) {
  const aliasOwners = new Map<string, Set<string>>();
  for (const reference of references) {
    for (const alias of referenceAliases(reference.name)) {
      const owners = aliasOwners.get(alias) ?? new Set<string>();
      owners.add(reference.id);
      aliasOwners.set(alias, owners);
    }
  }

  return [...aliasOwners.entries()].flatMap(([value, owners]) =>
    owners.size === 1 ? [{ value, id: [...owners][0]! }] : []
  );
}

function referenceAliases(name: string) {
  const normalized = normalizeWords(name);
  if (!normalized) return [];
  const corporateSuffixPattern = /\s+(?:inc|incorporated|llc|ltd|limited|corp|corporation|co|company)$/;
  const baseName = normalized.replace(corporateSuffixPattern, "").trim();
  const firstWord = normalized.split(" ")[0] ?? "";
  return [...new Set([
    normalized,
    baseName.length >= 4 ? baseName : "",
    firstWord.length >= 4 ? firstWord : ""
  ].filter(Boolean))];
}

function uniqueCustomers(scopes: readonly TeamshipReadScope[]) {
  const customers = new Map<string, string>();
  for (const scope of scopes) {
    if (!customers.has(scope.customerId)) customers.set(scope.customerId, scope.customerName);
  }
  return [...customers.entries()].map(([id, name]) => ({ id, name }));
}

function uniqueWarehouses(scopes: readonly TeamshipReadScope[]) {
  const warehouses = new Map<string, string>();
  for (const scope of scopes) {
    if (!warehouses.has(scope.warehouseId)) warehouses.set(scope.warehouseId, scope.warehouseName);
  }
  return [...warehouses.entries()].map(([id, name]) => ({ id, name }));
}

function normalizeWords(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]+/g, " ")
    .trim()
    .toLowerCase();
}
