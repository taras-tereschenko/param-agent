import type { UiThemePatch } from "../contracts/ui";

/**
 * Allowlist of semantic shadcn tokens the actor may tune per surface. Anything
 * outside this list is rejected. Raw CSS, class strings, and inline styles can
 * never appear here because the patch only carries token -> value pairs.
 */
export const APPROVED_SHADCN_TOKENS: string[] = [
  "background",
  "foreground",
  "card",
  "card-foreground",
  "popover",
  "popover-foreground",
  "primary",
  "primary-foreground",
  "secondary",
  "secondary-foreground",
  "muted",
  "muted-foreground",
  "accent",
  "accent-foreground",
  "destructive",
  "border",
  "input",
  "ring",
  "radius",
];

export type ThemePatchValidation = {
  ok: boolean;
  rejectedTokens: string[];
  requiresActionReview: boolean;
};

/**
 * Validate a theme patch. Surface/session scopes apply directly; profile/global
 * scopes are persistent changes that must route through Action Review (flagged
 * here, enforced elsewhere).
 */
export function validateThemePatch(patch: UiThemePatch): ThemePatchValidation {
  const allowed = new Set(APPROVED_SHADCN_TOKENS);
  const rejectedTokens = Object.keys(patch.tokens ?? {}).filter(
    (token) => !allowed.has(token),
  );
  const requiresActionReview =
    patch.scope === "profile" || patch.scope === "global";

  return {
    ok: rejectedTokens.length === 0,
    rejectedTokens,
    requiresActionReview,
  };
}
