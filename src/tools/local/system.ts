import type { ToolDefinition } from "../../contracts/tool";
import { nowIso } from "../../shared/time";
import type { ToolHandler } from "../executor";
import { ToolRegistry } from "../registry";
import {
  SystemHealthHandler,
  systemHealthDefinition,
  systemHealthToolName,
} from "./health";

export const systemTimeToolName = "system.time";

export const systemTimeDefinition: ToolDefinition = {
  name: systemTimeToolName,
  source: "local",
  description: "Return the current server time as an ISO-8601 timestamp.",
  riskLevel: "safe_read",
  approvalMode: "auto_if_safe",
  executionMode: "local",
  enabled: true,
};

/** Trivial, side-effect-free clock read. */
export class SystemTimeHandler implements ToolHandler {
  constructor(private readonly clock: () => string = () => nowIso()) {}

  async execute(_input: Record<string, unknown>): Promise<{ now: string }> {
    return { now: this.clock() };
  }
}

/**
 * Register the built-in safe, read-only local tools into a registry and their
 * handlers into a handler map.
 */
export function registerLocalTools(
  registry: ToolRegistry,
  handlers: Map<string, ToolHandler>,
): void {
  registry.register(systemHealthDefinition);
  handlers.set(systemHealthToolName, new SystemHealthHandler());

  registry.register(systemTimeDefinition);
  handlers.set(systemTimeToolName, new SystemTimeHandler());
}
