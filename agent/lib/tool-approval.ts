import type { Approval, ApprovalStatus } from "eve/tools/approval";

export type ParamToolApprovalMode = "auto" | "manual";

const AUTO_APPROVED: ApprovalStatus = "not-applicable";
const MANUAL_REVIEW: ApprovalStatus = "user-approval";

const SENSITIVE_REFERENCE_PATTERNS = [
  /(^|[/\\])\.aws($|[/\\])/iu,
  /(^|[/\\])\.codex($|[/\\])/iu,
  /(^|[/\\])\.env($|[./\\_-])/iu,
  /(^|[/\\])\.git($|[/\\])/iu,
  /(^|[/\\])\.gnupg($|[/\\])/iu,
  /(^|[/\\])\.netrc$/iu,
  /(^|[/\\])\.npmrc$/iu,
  /(^|[/\\])\.pypirc$/iu,
  /(^|[/\\])\.ssh($|[/\\])/iu,
  /(^|[/\\])id_(?:dsa|ecdsa|ed25519|rsa)$/iu,
  /(^|[/\\])private[-_.]?key($|[./\\_-])/iu,
  /credentials?/iu,
  /secrets?/iu,
  /tokens?/iu,
];

function inputString(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function inputNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function hasSensitiveReference(...values: unknown[]) {
  return values
    .map(inputString)
    .filter((value): value is string => value !== undefined)
    .some(value => SENSITIVE_REFERENCE_PATTERNS.some(pattern => pattern.test(value)));
}

function isBroadGlob(pattern: string | undefined) {
  if (!pattern) return false;

  const normalized = pattern.trim().replace(/^\.\//u, "");

  return normalized === "*"
    || normalized === "**"
    || normalized === "**/*"
    || normalized === "*/**"
    || normalized === "*/**/*"
    || /^[^*{}[\]]+\/\*\*\/\*$/u.test(normalized)
    || normalized.includes("**/.*")
}

function isWorkspaceRootPath(path: string | undefined) {
  const normalized = path?.replace(/\/+$/u, "");
  return normalized === undefined
    || normalized === ""
    || normalized === "."
    || normalized === "/workspace";
}

export function autoApproveTool<TInput = Record<string, unknown>>(): Approval<TInput> {
  return () => AUTO_APPROVED;
}

export function manualApproveTool<TInput = Record<string, unknown>>(): Approval<TInput> {
  return () => MANUAL_REVIEW;
}

export function readFileApproval(): Approval {
  return ({ toolInput }) => {
    const filePath = inputString(toolInput?.filePath);
    const limit = inputNumber(toolInput?.limit);

    if (!filePath || hasSensitiveReference(filePath) || (limit !== undefined && limit > 2000)) {
      return MANUAL_REVIEW;
    }

    return AUTO_APPROVED;
  };
}

export function globApproval(): Approval {
  return ({ toolInput }) => {
    const pattern = inputString(toolInput?.pattern);
    const path = inputString(toolInput?.path);
    const limit = inputNumber(toolInput?.limit);

    if (
      !pattern
      || hasSensitiveReference(pattern, path)
      || isBroadGlob(pattern)
      || (limit !== undefined && limit > 200)
    ) {
      return MANUAL_REVIEW;
    }

    return AUTO_APPROVED;
  };
}

export function grepApproval(): Approval {
  return ({ toolInput }) => {
    const pattern = inputString(toolInput?.pattern);
    const path = inputString(toolInput?.path);
    const glob = inputString(toolInput?.glob);
    const limit = inputNumber(toolInput?.limit);
    const context = inputNumber(toolInput?.context);

    if (
      !pattern
      || (isWorkspaceRootPath(path) && !glob)
      || hasSensitiveReference(pattern, path, glob)
      || isBroadGlob(glob)
      || (limit !== undefined && limit > 200)
      || (context !== undefined && context > 20)
    ) {
      return MANUAL_REVIEW;
    }

    return AUTO_APPROVED;
  };
}
