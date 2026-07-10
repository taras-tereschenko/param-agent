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
  rejectedValues: string[];
  requiresActionReview: boolean;
};

const MAX_TOKEN_VALUE_LENGTH = 64;
// Block CSS-injection vectors: url()/imports, script, braces/brackets, and
// property terminators that could smuggle extra declarations.
const UNSAFE_VALUE = /url\(|@import|javascript:|expression\(|[{}<>;]/i;
const RADIUS_OK = /^[0-9.]+(px|rem|em|%)?$/;

/** A token value must look like a plain color/number token, never raw CSS. */
export function isSafeThemeValue(token: string, value: string): boolean {
  if (value.length === 0 || value.length > MAX_TOKEN_VALUE_LENGTH) {
    return false;
  }
  if (UNSAFE_VALUE.test(value)) {
    return false;
  }
  if (token === "radius") {
    return RADIUS_OK.test(value.trim());
  }
  // Color-ish tokens: only word chars, spaces, and a small safe punctuation set.
  return /^[a-zA-Z0-9 .,%#()/-]+$/.test(value);
}

/**
 * Validate a theme patch: allow-listed token KEYS and safe token VALUES (no raw
 * CSS / url() / script). Surface/session scopes apply directly; profile/global
 * scopes are persistent changes that route through Action Review (flagged here,
 * enforced elsewhere).
 */
export function validateThemePatch(patch: UiThemePatch): ThemePatchValidation {
  const allowed = new Set(APPROVED_SHADCN_TOKENS);
  const tokens = patch.tokens ?? {};
  const rejectedTokens = Object.keys(tokens).filter(
    (token) => !allowed.has(token),
  );
  const rejectedValues = Object.entries(tokens)
    .filter(([token, value]) => allowed.has(token) && !isSafeThemeValue(token, value))
    .map(([token]) => token);
  if (patch.radius !== undefined && !RADIUS_OK.test(patch.radius.trim())) {
    rejectedValues.push("radius");
  }
  const requiresActionReview =
    patch.scope === "profile" || patch.scope === "global";

  return {
    ok: rejectedTokens.length === 0 && rejectedValues.length === 0,
    rejectedTokens,
    rejectedValues,
    requiresActionReview,
  };
}
