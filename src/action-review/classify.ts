import type { ActionKind, RiskLabel, TrustScope } from "../contracts/action-review";
import type { ToolRiskLevel } from "../contracts/tool";

export type ActionToClassify = {
  actionKind: ActionKind | string;
  /** For tool_call actions, the registered tool's risk level. */
  toolRiskLevel?: ToolRiskLevel;
};

export type RiskClassification = {
  risk: RiskLabel;
  requiredTrustScope: TrustScope;
  /** A consequential action always needs review; safe read-only does not. */
  consequential: boolean;
};

const TOOL_RISK_TO_LABEL: Record<ToolRiskLevel, RiskLabel> = {
  safe_read: "safe",
  write: "medium",
  server: "critical",
  external_send: "high",
  private_data: "high",
};

/**
 * Deterministic risk classification for a proposed action. The actor's own risk
 * hint is advisory; classification here is authoritative and drives policy.
 */
export function classifyRisk(action: ActionToClassify): RiskClassification {
  switch (action.actionKind) {
    case "tool_call": {
      const level = action.toolRiskLevel ?? "write";
      const risk = TOOL_RISK_TO_LABEL[level];
      const requiredTrustScope: TrustScope =
        level === "server" ? "server_admin" : "global";
      return {
        risk,
        requiredTrustScope,
        consequential: risk !== "safe",
      };
    }
    case "send_external_message":
      return { risk: "high", requiredTrustScope: "global", consequential: true };
    case "config_change":
      return {
        risk: "high",
        requiredTrustScope: "server_admin",
        consequential: true,
      };
    case "server_action":
      return {
        risk: "critical",
        requiredTrustScope: "server_admin",
        consequential: true,
      };
    case "schedule_create":
    case "schedule_update":
      return { risk: "medium", requiredTrustScope: "chat", consequential: true };
    case "memory_sensitive":
      return { risk: "medium", requiredTrustScope: "global", consequential: true };
    case "ui_theme_persist":
      return { risk: "low", requiredTrustScope: "global", consequential: true };
    default:
      // Unknown action kinds are treated as consequential by default.
      return { risk: "high", requiredTrustScope: "global", consequential: true };
  }
}
