import { readFileSync } from "node:fs";

import type { SecretRef } from "./schema";

export type SecretEnv = Record<string, string | undefined>;

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
