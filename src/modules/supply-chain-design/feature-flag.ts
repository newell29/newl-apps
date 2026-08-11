export const SUPPLY_CHAIN_DESIGN_STUDIO_FEATURE_FLAG = "SUPPLY_CHAIN_DESIGN_STUDIO_ENABLED";

export function isSupplyChainDesignStudioEnabled(env: NodeJS.ProcessEnv = process.env) {
  const explicit = env[SUPPLY_CHAIN_DESIGN_STUDIO_FEATURE_FLAG]?.trim().toLowerCase();

  if (explicit) {
    return ["1", "true", "yes", "on"].includes(explicit);
  }

  return env.NODE_ENV === "development" || env.NODE_ENV === "test";
}
