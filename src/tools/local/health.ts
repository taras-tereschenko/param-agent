import type { ToolDefinition } from "../../contracts/tool";
import type { ToolHandler } from "../executor";

export const systemHealthToolName = "system.health";

export const systemHealthDefinition: ToolDefinition = {
  name: systemHealthToolName,
  source: "local",
  description: "Report Param process liveness and uptime in seconds.",
  riskLevel: "safe_read",
  approvalMode: "auto_if_safe",
  executionMode: "local",
  enabled: true,
};

/** Trivial, side-effect-free liveness probe. */
export class SystemHealthHandler implements ToolHandler {
  constructor(private readonly uptimeSeconds: () => number = () => process.uptime()) {}

  async execute(
    _input: Record<string, unknown>,
  ): Promise<{ ok: true; uptimeSeconds: number }> {
    return { ok: true, uptimeSeconds: Math.floor(this.uptimeSeconds()) };
  }
}
