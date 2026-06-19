import { readFileSync } from "node:fs";

import type { ParamConfig, SecretRef } from "./schema";

export type SecretEnv = Record<string, string | undefined>;

export type SecretValidationIssue = {
  path: string;
  message: string;
};

export function resolveSecretRef(
  ref: SecretRef,
  env: SecretEnv = Bun.env,
): string {
  if ("env" in ref) {
    const value = env[ref.env];

    if (!value) {
      throw new Error(`missing required environment secret: ${ref.env}`);
    }

    return value;
  }

  if ("file" in ref) {
    const value = readFileSync(ref.file, "utf8").trim();

    if (!value) {
      throw new Error(`secret file is empty: ${ref.file}`);
    }

    return value;
  }

  throw new Error(
    `secret provider is not implemented yet: ${ref.provider}:${ref.key}`,
  );
}

export function validateSecretRefs(
  value: unknown,
  env: SecretEnv = Bun.env,
): SecretValidationIssue[] {
  const issues: SecretValidationIssue[] = [];
  visitSecretRefs(value, "$", env, issues);
  return issues;
}

export function assertSecretRefsResolvable(
  value: unknown,
  env: SecretEnv = Bun.env,
): void {
  const issues = validateSecretRefs(value, env);

  if (issues.length === 0) {
    return;
  }

  throw new Error(
    [
      `missing or unreadable config secrets (${issues.length})`,
      ...issues.map((issue) => `- ${issue.path}: ${issue.message}`),
    ].join("\n"),
  );
}

export function validateRequiredConfigSecretRefs(
  config: ParamConfig,
  env: SecretEnv = Bun.env,
): SecretValidationIssue[] {
  const issues: SecretValidationIssue[] = [];

  validateDatabaseUrlSecretRef(
    config.database.url,
    "$.database.url",
    env,
    issues,
  );

  config.trustedUsers.forEach((trustedUser, index) => {
    visitSecretRefs(
      trustedUser.platformUserId,
      `$.trustedUsers[${index}].platformUserId`,
      env,
      issues,
    );
    visitSecretRefs(
      trustedUser.scopes,
      `$.trustedUsers[${index}].scopes`,
      env,
      issues,
    );
  });

  const telegram = config.channels.telegram;
  if (telegram?.enabled) {
    visitSecretRefs(
      telegram.access.allowedPrivateUserIds,
      "$.channels.telegram.access.allowedPrivateUserIds",
      env,
      issues,
    );
    visitSecretRefs(
      telegram.access.allowedGroupChatIds,
      "$.channels.telegram.access.allowedGroupChatIds",
      env,
      issues,
    );
    visitSecretRefs(
      telegram.access.allowedTopicIds,
      "$.channels.telegram.access.allowedTopicIds",
      env,
      issues,
    );

    for (const [accountId, account] of Object.entries(telegram.accounts)) {
      visitSecretRefs(
        account.botToken,
        `$.channels.telegram.accounts.${accountId}.botToken`,
        env,
        issues,
      );
    }
  }

  return issues;
}

export function assertRequiredConfigSecretRefsResolvable(
  config: ParamConfig,
  env: SecretEnv = Bun.env,
): void {
  const issues = validateRequiredConfigSecretRefs(config, env);

  if (issues.length === 0) {
    return;
  }

  throw new Error(
    [
      `missing or unreadable required config secrets (${issues.length})`,
      ...issues.map((issue) => `- ${issue.path}: ${issue.message}`),
    ].join("\n"),
  );
}

function validateDatabaseUrlSecretRef(
  ref: SecretRef,
  path: string,
  env: SecretEnv,
  issues: SecretValidationIssue[],
) {
  let value: string;

  try {
    value = resolveSecretRef(ref, env);
  } catch (error) {
    issues.push({
      path,
      message: error instanceof Error ? error.message : String(error),
    });
    return;
  }

  try {
    const url = new URL(value);
    if (!["postgres:", "postgresql:"].includes(url.protocol)) {
      issues.push({
        path,
        message:
          "DATABASE_URL must use the postgres:// or postgresql:// protocol",
      });
    }
  } catch {
    issues.push({
      path,
      message: "DATABASE_URL must be a valid Postgres URL",
    });
  }
}

function visitSecretRefs(
  value: unknown,
  path: string,
  env: SecretEnv,
  issues: SecretValidationIssue[],
) {
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      visitSecretRefs(item, `${path}[${index}]`, env, issues),
    );
    return;
  }

  if (!isRecord(value)) {
    return;
  }

  if (isSecretRef(value)) {
    try {
      resolveSecretRef(value, env);
    } catch (error) {
      issues.push({
        path,
        message: error instanceof Error ? error.message : String(error),
      });
    }
    return;
  }

  for (const [key, item] of Object.entries(value)) {
    visitSecretRefs(item, `${path}.${key}`, env, issues);
  }
}

function isSecretRef(value: Record<string, unknown>): value is SecretRef {
  return (
    typeof value.env === "string" ||
    typeof value.file === "string" ||
    (value.provider === "future_secret_manager" &&
      typeof value.key === "string")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
