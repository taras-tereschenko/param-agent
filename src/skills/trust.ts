import type { SkillSummary } from "./registry";

/**
 * A configured scope entry describing where a skill may be used. `mode` other
 * than "enabled" (e.g. "disabled", "restricted") does not count as usable.
 */
export type SkillScopeConfig = {
  scopeType: string;
  scopeId?: string;
  mode: string;
};

export type SkillScope = {
  type: string;
  id?: string;
};

/**
 * Decide whether a skill may be USED (as procedural knowledge) in a scope.
 *
 * A skill is usable when it is trusted+enabled AND either no scopes are
 * configured (global availability) or at least one configured scope matches the
 * given scope with mode "enabled".
 *
 * IMPORTANT: this only governs whether the skill's advice is available. Skill
 * tool requirements do NOT grant tool access. The Tool Registry decides whether
 * a tool exists and Action Review still gates every individual tool call.
 */
export function canUseSkillInScope(
  skill: SkillSummary,
  scope: SkillScope,
  scopes: SkillScopeConfig[],
): boolean {
  if (!skill.enabled || skill.trustStatus !== "trusted") {
    return false;
  }

  if (scopes.length === 0) {
    return true;
  }

  return scopes.some(
    (configured) =>
      configured.mode === "enabled" &&
      configured.scopeType === scope.type &&
      (configured.scopeId === undefined || configured.scopeId === scope.id),
  );
}
