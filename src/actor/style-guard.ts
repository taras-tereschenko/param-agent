/**
 * Visible-chat style guard (docs/PROMPTS.md "Style Guard Layer").
 *
 * It enforces Param's voice on visible messages before delivery. It is NOT a
 * slang limiter — slang is normal chat language. It catches assistant-like
 * phrasing, markdown that breaks on messaging platforms, em-dashes, naked URLs,
 * trailing periods on short messages, and mascot/tiny-helper self-description.
 */
export type StyleViolationCode =
  | "too_long"
  | "markdown_bold"
  | "markdown_heading"
  | "code_block"
  | "table"
  | "bullet_list"
  | "em_dash"
  | "naked_url"
  | "trailing_period"
  | "banned_phrase"
  | "contrastive_structure"
  | "robotic_prefix"
  | "mascot_selfdesc";

export type StyleViolation = {
  code: StyleViolationCode;
  message: string;
  /** Fixable mechanically by applyStyleFixes (vs needs a rewrite). */
  autoFixable: boolean;
};

export const MAX_BUBBLE_LENGTH = 600;

const BANNED_PHRASES = [
  "as an ai",
  "regarding your request",
  "in summary",
  "i'm here to assist",
  "i am here to assist",
  "how can i help you",
  "let me know if you need anything else",
  "i'm here to help",
];

const MASCOT_PATTERNS = [
  /\byour friendly assistant\b/i,
  /\bas your assistant\b/i,
  /\bi'?m just a (little|tiny|small|humble) (helper|bot|assistant|ai)\b/i,
  /\bi'?m a (little|tiny|friendly) (helper|bot|assistant)\b/i,
];

const NAKED_URL = /(^|[^(\]])\bhttps?:\/\/[^\s)]+/i;
const MARKDOWN_LINK = /\[[^\]]+\]\((https?:\/\/[^\s)]+)\)/i;

export function checkStyle(text: string): StyleViolation[] {
  const violations: StyleViolation[] = [];
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();

  if (trimmed.length > MAX_BUBBLE_LENGTH) {
    violations.push({
      code: "too_long",
      message: `message exceeds ${MAX_BUBBLE_LENGTH} chars`,
      // Truncatable rather than dropped: a trimmed reply beats silence.
      autoFixable: true,
    });
  }

  if (/\*\*[^*]+\*\*/.test(trimmed) || /__[^_]+__/.test(trimmed)) {
    violations.push({
      code: "markdown_bold",
      message: "markdown bold breaks on messaging platforms",
      autoFixable: true,
    });
  }

  if (/^\s{0,3}#{1,6}\s/m.test(trimmed)) {
    violations.push({
      code: "markdown_heading",
      message: "markdown headings do not belong in chat",
      autoFixable: true,
    });
  }

  if (/```/.test(trimmed)) {
    violations.push({
      code: "code_block",
      message: "code blocks break normal conversation",
      autoFixable: false,
    });
  }

  // A table-like line: two or more pipe separators.
  if (/^\s*\|.*\|.*\|/m.test(trimmed)) {
    violations.push({
      code: "table",
      message: "tables should be render_ui, not raw chat",
      autoFixable: false,
    });
  }

  // Multiple bullet lines -> a list in normal chat.
  const bulletLines = trimmed
    .split("\n")
    .filter((line) => /^\s*[-*]\s+/.test(line)).length;
  if (bulletLines >= 2) {
    violations.push({
      code: "bullet_list",
      message: "bullet lists read like a briefing, not a text",
      autoFixable: false,
    });
  }

  if (trimmed.includes("—")) {
    violations.push({
      code: "em_dash",
      message: "em-dashes are banned",
      autoFixable: true,
    });
  }

  if (NAKED_URL.test(trimmed) && !MARKDOWN_LINK.test(trimmed)) {
    violations.push({
      code: "naked_url",
      message: "format links as [label](url)",
      autoFixable: true,
    });
  }

  if (isShortConversational(trimmed) && /[^.]\.$/.test(trimmed)) {
    violations.push({
      code: "trailing_period",
      message: "skip trailing periods on short messages",
      autoFixable: true,
    });
  }

  for (const phrase of BANNED_PHRASES) {
    if (lower.includes(phrase)) {
      violations.push({
        code: "banned_phrase",
        message: `banned phrase: "${phrase}"`,
        autoFixable: false,
      });
    }
  }

  if (/\bnot just\b[^.]*\bbut\b/i.test(trimmed)) {
    violations.push({
      code: "contrastive_structure",
      message: 'avoid "not just x, but y"; pick one side',
      autoFixable: false,
    });
  }

  if (/^\s*small update:/i.test(trimmed)) {
    violations.push({
      code: "robotic_prefix",
      message: 'robotic prefix "small update:"',
      autoFixable: true,
    });
  }

  for (const pattern of MASCOT_PATTERNS) {
    if (pattern.test(trimmed)) {
      violations.push({
        code: "mascot_selfdesc",
        message: "no mascot/tiny-helper self-description",
        autoFixable: false,
      });
      break;
    }
  }

  return violations;
}

export function passesStyle(text: string): boolean {
  return checkStyle(text).length === 0;
}

/**
 * Apply the mechanical fixes (em-dash, bold, heading, trailing period, naked
 * URL, robotic prefix). Phrase-level and structural issues are left for the
 * actor/adapter to rewrite.
 */
export function applyStyleFixes(text: string): string {
  let out = text;
  // too long -> truncate at a word boundary near the cap rather than drop.
  if (out.length > MAX_BUBBLE_LENGTH) {
    const slice = out.slice(0, MAX_BUBBLE_LENGTH - 1);
    const lastSpace = slice.lastIndexOf(" ");
    out = `${(lastSpace > MAX_BUBBLE_LENGTH * 0.6 ? slice.slice(0, lastSpace) : slice).trimEnd()}…`;
  }
  // em-dash -> comma
  out = out.replace(/\s*—\s*/g, ", ");
  // bold markers
  out = out.replace(/\*\*([^*]+)\*\*/g, "$1").replace(/__([^_]+)__/g, "$1");
  // headings
  out = out.replace(/^\s{0,3}#{1,6}\s+/gm, "");
  // robotic prefix
  out = out.replace(/^\s*small update:\s*/i, "");
  // naked url -> markdown link (only when not already a link)
  if (!MARKDOWN_LINK.test(out)) {
    out = out.replace(/(^|[^(\]])(\bhttps?:\/\/[^\s)]+)/gi, (_m, pre, url) => {
      return `${pre}[link](${url})`;
    });
  }
  // trailing period on short messages
  const trimmed = out.trim();
  if (isShortConversational(trimmed) && /[^.]\.$/.test(trimmed)) {
    out = trimmed.replace(/\.$/, "");
  }
  return out;
}

export type StyleResult = {
  ok: boolean;
  text: string;
  remaining: StyleViolation[];
};

/**
 * Run the guard, optionally rewriting mechanical issues. Returns the (possibly
 * fixed) text and any violations that still need a real rewrite.
 */
export function guardVisibleText(
  text: string,
  options: { rewriteOnFailure: boolean },
): StyleResult {
  const initial = checkStyle(text);
  if (initial.length === 0) {
    return { ok: true, text, remaining: [] };
  }
  if (!options.rewriteOnFailure) {
    return { ok: false, text, remaining: initial };
  }
  const fixed = applyStyleFixes(text);
  const remaining = checkStyle(fixed);
  return { ok: remaining.length === 0, text: fixed, remaining };
}

function isShortConversational(text: string): boolean {
  return text.length <= 200 && !text.includes("\n");
}
