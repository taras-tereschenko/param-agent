import type { ToolCallOutputPayload } from "../contracts/actor-output";
import type { ToolDefinition, ToolRiskLevel } from "../contracts/tool";

export type ToolPolicyContext = {
  safeAutoRunTools: string[];
  requesterIsTrusted: boolean;
};

export type ToolPolicyDecision = {
  decision: "auto_allow" | "needs_approval" | "deny";
  reason: string;
};

/**
 * Risk levels that always carry real-world consequences (writes, server ops,
 * outbound sends, private data access) and therefore require approval.
 */
const consequentialRisks: ReadonlySet<ToolRiskLevel> = new Set<ToolRiskLevel>([
  "write",
  "server",
  "external_send",
  "private_data",
]);

/**
 * Decide the POLICY for a tool call. This does not perform approval — Action
 * Review (injected elsewhere) is the final authority. It only classifies a
 * call as auto-allowable, needing approval, or outright denied.
 *
 * The actor's `riskHint`/`approvalPreference` on the call are advisory only;
 * we always trust the registered `def`.
 */
export function decideToolPolicy(
  def: ToolDefinition,
  _call: ToolCallOutputPayload,
  ctx: ToolPolicyContext,
): ToolPolicyDecision {
  if (def.enabled === false) {
    return {
      decision: "deny",
      reason: `Tool "${def.name}" is disabled.`,
    };
  }

  // Explicit operator intent to always review wins over any auto-run allowance.
  if (def.approvalMode === "manual") {
    return {
      decision: "needs_approval",
      reason: `Tool "${def.name}" is configured for manual approval.`,
    };
  }

  const isSafeRead = def.riskLevel === "safe_read";
  const autoRunnable =
    isSafeRead &&
    (ctx.safeAutoRunTools.includes(def.name) ||
      def.approvalMode === "auto_if_safe");

  if (autoRunnable) {
    if (!ctx.requesterIsTrusted) {
      return {
        decision: "needs_approval",
        reason: `Tool "${def.name}" is safe to auto-run, but the requester is not trusted.`,
      };
    }
    return {
      decision: "auto_allow",
      reason: `Tool "${def.name}" is a safe read-only tool approved for auto-run.`,
    };
  }

  if (consequentialRisks.has(def.riskLevel)) {
    return {
      decision: "needs_approval",
      reason: `Tool "${def.name}" is consequential (risk "${def.riskLevel}") and requires approval.`,
    };
  }

  // safe_read but not on the auto-run allowlist / not auto_if_safe.
  return {
    decision: "needs_approval",
    reason: `Tool "${def.name}" is not on the safe auto-run allowlist and requires approval.`,
  };
}
