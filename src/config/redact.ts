const ENV_REDACTED = "env:<redacted>";
const FILE_REDACTED = "file:<redacted>";
const KEY_REDACTED = "key:<redacted>";

export type Redacted<T> =
  T extends readonly (infer U)[] ? Redacted<U>[]
  : T extends { env: string } ? { env: typeof ENV_REDACTED }
  : T extends { file: string } ? { file: typeof FILE_REDACTED }
  : T extends { provider: infer P extends string; key: string } ? {
      provider: P;
      key: typeof KEY_REDACTED;
    }
  : T extends object ? { [K in keyof T]: Redacted<T[K]> }
  : T;

export function redactConfig<T>(config: T): Redacted<T> {
  return redactValue(config) as Redacted<T>;
}

function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactValue);
  }

  if (isRecord(value)) {
    if (typeof value.env === "string") {
      return { env: ENV_REDACTED };
    }

    if (typeof value.file === "string") {
      return { file: FILE_REDACTED };
    }

    if (typeof value.provider === "string" && typeof value.key === "string") {
      return { provider: value.provider, key: KEY_REDACTED };
    }

    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, redactValue(item)]),
    );
  }

  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
