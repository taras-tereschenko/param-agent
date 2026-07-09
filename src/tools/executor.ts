import {
  toolCallOutputPayloadSchema,
  type ToolCallOutputPayload,
} from "../contracts/actor-output";
import type { ToolDefinition, ToolResultPayload } from "../contracts/tool";
import { toErrorInfo } from "../shared/errors";
import { decideToolPolicy, type ToolPolicyContext } from "./policy";
import { ToolRegistry } from "./registry";
import { buildToolResult, normalizeToolOutput } from "./result";

/** Executes the concrete side effect for a tool. Injected so it stays testable. */
export interface ToolHandler {
  execute(input: Record<string, unknown>): Promise<unknown>;
}

/**
 * Local port for the Action Review subsystem (the real approval authority).
 * The executor never approves on its own; it asks this port whenever policy
 * says a call needs approval.
 */
export interface ActionReviewPort {
  authorize(
    call: ToolCallOutputPayload,
    def: ToolDefinition,
  ): Promise<{ allowed: boolean; reason: string }>;
}

export class ToolExecutor {
  constructor(
    private readonly registry: ToolRegistry,
    private readonly handlers: Map<string, ToolHandler>,
    private readonly actionReview: ActionReviewPort,
    private readonly policyCtx: ToolPolicyContext,
  ) {}

  async run(call: ToolCallOutputPayload): Promise<ToolResultPayload> {
    const parsed = toolCallOutputPayloadSchema.parse(call);

    const def = this.registry.get(parsed.toolName);
    if (!def) {
      return buildToolResult({
        toolCallId: parsed.toolCallId,
        toolName: parsed.toolName,
        status: "blocked",
        error: {
          code: "not_found",
          message: `Unknown tool: ${parsed.toolName}`,
        },
      });
    }

    const decision = decideToolPolicy(def, parsed, this.policyCtx);

    if (decision.decision === "deny") {
      return buildToolResult({
        toolCallId: parsed.toolCallId,
        toolName: parsed.toolName,
        status: "blocked",
        error: { code: "policy_denied", message: decision.reason },
      });
    }

    // Consequential calls MUST NOT execute without either auto_allow or an
    // allowed authorize(). Only auto_allow bypasses Action Review.
    if (decision.decision === "needs_approval") {
      const auth = await this.actionReview.authorize(parsed, def);
      if (!auth.allowed) {
        return buildToolResult({
          toolCallId: parsed.toolCallId,
          toolName: parsed.toolName,
          status: "blocked",
          error: { code: "approval_required", message: auth.reason },
        });
      }
    }

    const handler = this.handlers.get(parsed.toolName);
    if (!handler) {
      return buildToolResult({
        toolCallId: parsed.toolCallId,
        toolName: parsed.toolName,
        status: "failed",
        error: {
          code: "not_found",
          message: `No handler registered for tool: ${parsed.toolName}`,
        },
      });
    }

    try {
      const raw = await handler.execute(parsed.input);
      const { output, textPreview } = normalizeToolOutput(raw);
      return buildToolResult({
        toolCallId: parsed.toolCallId,
        toolName: parsed.toolName,
        status: "succeeded",
        output,
        textPreview,
      });
    } catch (error) {
      return buildToolResult({
        toolCallId: parsed.toolCallId,
        toolName: parsed.toolName,
        status: "failed",
        error: toErrorInfo(error),
      });
    }
  }
}
