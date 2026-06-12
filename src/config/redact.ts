const REDACTED = "env:<redacted>";

export function redactConfig<T>(config: T): T {
  return redactValue(config) as T;
}

function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactValue);
  }

  if (isRecord(value)) {
    if (typeof value.env === "string") {
      return { env: REDACTED };
    }

    if (typeof value.file === "string") {
      return { file: "file:<redacted>" };
    }

    if (typeof value.provider === "string" && typeof value.key === "string") {
      return { provider: value.provider, key: "key:<redacted>" };
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

