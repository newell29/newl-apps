import { ModuleKey, PlatformRole } from "@prisma/client";

import type { RoleAccessMatrixEntry } from "@/modules/settings/types";
import { DEFAULT_ROLE_MATRIX, ROLE_DESCRIPTIONS, getDefaultAccessibleModuleKeys } from "@/server/auth/role-policy";

export const PLATFORM_ROLES = Object.values(PlatformRole);

export function formatPlatformRole(role: PlatformRole) {
  return role
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function buildRoleAccessMatrix(args: {
  tenantModules: Array<{ id: string; key: ModuleKey; name: string }>;
  rolePolicies: Array<{ role: PlatformRole; canMutate: boolean }>;
  overrides: Array<{ role: PlatformRole; moduleId: string; enabled: boolean }>;
}): RoleAccessMatrixEntry[] {
  const overridesByRole = new Map<PlatformRole, Map<string, boolean>>();
  const policyByRole = new Map(args.rolePolicies.map((policy) => [policy.role, policy.canMutate]));

  for (const override of args.overrides) {
    const roleMap = overridesByRole.get(override.role) ?? new Map<string, boolean>();
    roleMap.set(override.moduleId, override.enabled);
    overridesByRole.set(override.role, roleMap);
  }

  return PLATFORM_ROLES.map((role) => {
    const defaultKeys = new Set(getDefaultAccessibleModuleKeys(role));
    const roleOverrides = overridesByRole.get(role) ?? new Map<string, boolean>();
    const modules = args.tenantModules.map((module) => ({
      key: module.key,
      name: module.name,
      enabled: roleOverrides.has(module.id)
        ? roleOverrides.get(module.id) === true
        : defaultKeys.has(module.key)
    }));

    return {
      role,
      label: ROLE_DESCRIPTIONS[role].label,
      description: ROLE_DESCRIPTIONS[role].description,
      visibilitySummary: ROLE_DESCRIPTIONS[role].visibilitySummary,
      canMutate:
        role === PlatformRole.ADMIN
          ? true
          : role === PlatformRole.READ_ONLY
            ? false
            : policyByRole.get(role) ?? DEFAULT_ROLE_MATRIX[role].canMutate,
      canMutateLocked: role === PlatformRole.ADMIN || role === PlatformRole.READ_ONLY,
      modules
    };
  });
}
