import type { ParamConfig } from "./schema";

export function defineParamConfig<const T extends ParamConfig>(config: T): T {
  return config;
}

