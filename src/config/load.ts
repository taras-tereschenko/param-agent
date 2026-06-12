import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import baseConfig from "../../param.config";
import { paramConfigSchema, type ParamConfig, type ParamConfigOverride } from "./schema";

export async function loadConfig(): Promise<ParamConfig> {
  const localConfig = await loadLocalConfig();
  const merged = mergeConfig(baseConfig, localConfig ?? {});

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

function mergeConfig<T>(base: T, override: ParamConfigOverride): T {
  return deepMerge(base, override) as T;
}

function deepMerge(base: unknown, override: unknown): unknown {
  if (Array.isArray(base) || Array.isArray(override)) {
    return override ?? base;
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

