import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import baseConfig from "../../param.config";
import { paramConfigSchema, type ParamConfig, type ParamConfigOverride } from "./schema";

export type ConfigEnv = Record<string, string | undefined>;

export type LoadConfigOptions = {
  env?: ConfigEnv;
};

export async function loadConfig(
  options: LoadConfigOptions = {},
): Promise<ParamConfig> {
  const localConfig = await loadLocalConfig();
  const envConfig = configOverrideFromEnv(options.env ?? Bun.env);
  const merged = mergeConfig(
    mergeConfig(baseConfig, localConfig ?? {}),
    envConfig,
  );

  return paramConfigSchema.parse(merged);
}

async function loadLocalConfig(): Promise<ParamConfigOverride | undefined> {
  const localPath = resolve(process.cwd(), "param.config.local.ts");

  if (!existsSync(localPath)) {
    return undefined;
  }

  const module = (await import(pathToFileURL(localPath).href)) as {
    default?: ParamConfigOverride;
  };

  return module.default;
}

export function mergeConfig(
  base: ParamConfig,
  override: ParamConfigOverride,
): ParamConfig {
  return deepMerge(base, override) as ParamConfig;
}

export function configOverrideFromEnv(env: ConfigEnv): ParamConfigOverride {
  const override: ParamConfigOverride = {};

  assignIfPresent(override, ["app", "environment"], env.PARAM_ENV);
  assignIfPresent(override, ["app", "publicBaseUrl"], env.PARAM_PUBLIC_BASE_URL);
  assignIfPresent(override, ["database", "provider"], env.DATABASE_PROVIDER);
  assignIfPresent(
    override,
    ["database", "provisioningMode"],
    env.DATABASE_PROVISIONING_MODE,
  );
  assignIfPresent(
    override,
    ["database", "ssl"],
    parseDatabaseSslEnv(env.DATABASE_SSL),
  );
  assignIfPresent(
    override,
    ["observability", "logs", "level"],
    env.PARAM_LOG_LEVEL,
  );

  return override;
}

function deepMerge(base: unknown, override: unknown): unknown {
  if (Array.isArray(base) || Array.isArray(override)) {
    return override ?? base;
  }

  if (isSecretRefRecord(override)) {
    return override;
  }

  if (isRecord(base) && isRecord(override)) {
    const merged: Record<string, unknown> = { ...base };

    for (const [key, value] of Object.entries(override)) {
      merged[key] = key in merged ? deepMerge(merged[key], value) : value;
    }

    return merged;
  }

  return override ?? base;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assignIfPresent(
  target: Record<string, unknown>,
  path: string[],
  value: unknown,
) {
  if (value === undefined || value === "") {
    return;
  }

  const [head, ...tail] = path;
  if (!head) {
    return;
  }

  if (tail.length === 0) {
    target[head] = value;
    return;
  }

  const next = isRecord(target[head]) ? target[head] : {};
  target[head] = next;
  assignIfPresent(next, tail, value);
}

function parseDatabaseSslEnv(value: string | undefined) {
  if (!value) {
    return undefined;
  }

  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  return value;
}

function isSecretRefRecord(value: unknown) {
  return (
    isRecord(value) &&
    (typeof value.env === "string" ||
      typeof value.file === "string" ||
      (typeof value.provider === "string" && typeof value.key === "string"))
  );
}
