import type {
  PlatformCapabilitySummary,
  PromptApprovalPolicy,
  PromptContextRefs,
  PromptLayer,
  PromptPacket,
  PromptRunType,
  StyleGuardPolicy,
} from "../contracts/prompt";
import { newId } from "../contracts/ids";
import { nowIso } from "../shared/time";
import {
  HUMAN_TEXT_AGENT_LAYER_ID,
  humanTextAgentPrompt,
} from "./base";
import {
  allowedOutputsLayer,
  approvalPolicyLayer,
  identityVoiceLayer,
  memoryContextLayer,
  multiBubbleLayer,
  platformCapabilityLayer,
  skillContextLayer,
  styleGuardLayer,
} from "./layers";
import { runContract } from "./contracts";

export type CompilePromptInput = {
  actorRunId: string;
  sessionId: string;
  runType: PromptRunType;
  /** Runtime adapter frame, prepended verbatim as layer 1 when present. */
  runtimeFrame?: string;
  platformCapabilities: PlatformCapabilitySummary;
  styleGuard: StyleGuardPolicy;
  approvalPolicy: PromptApprovalPolicy;
  sessionContextText?: string;
  skillContextText?: string;
  memoryContextText?: string;
  steeringText?: string;
  /** Overrides the run contract's allowed outputs (e.g. ambient wake). */
  allowedOutputs?: string[];
  contextRefs: PromptContextRefs;
  now?: Date;
};

/**
 * Compile the ordered prompt packet (docs/PROMPTS.md "Prompt Layers"):
 *   1. runtime adapter frame
 *   2. human text agent prompt (VERBATIM)
 *   3. Param identity and voice
 *   4. run contract
 *   5. platform capability summary
 *   6. session context
 *   7. memory context
 *   8. active state and live steering
 *   9. allowed outputs
 *  10. approval and tool policy
 *  11. style guard
 * Layers that do not apply to a run are omitted.
 */
export function compilePromptPacket(input: CompilePromptInput): PromptPacket {
  const contract = runContract(input.runType);
  const layers: PromptLayer[] = [];

  if (input.runtimeFrame && input.runtimeFrame.trim().length > 0) {
    layers.push({
      id: "runtime_adapter_frame",
      title: "Runtime Adapter Frame",
      content: input.runtimeFrame,
      verbatim: false,
    });
  }

  // 2. Verbatim base — never modified.
  layers.push({
    id: HUMAN_TEXT_AGENT_LAYER_ID,
    title: "Human Text Agent Prompt (verbatim)",
    content: humanTextAgentPrompt,
    verbatim: true,
  });

  // 3. Param-specific identity/voice + multi-bubble rule (after the base).
  if (contract.visible) {
    layers.push({
      id: "param_identity_voice",
      title: "Param Identity and Voice",
      content: `${identityVoiceLayer}\n\n${multiBubbleLayer}`,
      verbatim: false,
    });
  }

  // 4. Run contract.
  layers.push({
    id: "run_contract",
    title: `Run Contract: ${contract.runType}`,
    content: `${contract.purpose}\n\n${contract.guidance}`,
    verbatim: false,
  });

  // 5. Platform capabilities (visible runs need channel awareness).
  if (contract.visible) {
    layers.push({
      id: "platform_capabilities",
      title: "Platform Capabilities",
      content: platformCapabilityLayer(input.platformCapabilities),
      verbatim: false,
    });
  }

  // 6. Session context.
  if (input.sessionContextText && input.sessionContextText.trim().length > 0) {
    layers.push({
      id: "session_context",
      title: "Session Context",
      content: input.sessionContextText,
      verbatim: false,
    });
  }

  // 6b. Skills (procedural knowledge, trust-gated). Only present when relevant
  // trusted skills were selected, so it adds nothing when none apply.
  if (input.skillContextText && input.skillContextText.trim().length > 0) {
    layers.push({
      id: "skill_context",
      title: "Relevant Skills",
      content: skillContextLayer(input.skillContextText),
      verbatim: false,
    });
  }

  // 7. Memory context.
  if (input.memoryContextText !== undefined) {
    layers.push({
      id: "memory_context",
      title: "Memory Context",
      content: memoryContextLayer(input.memoryContextText),
      verbatim: false,
    });
  }

  // 8. Active state + live steering.
  if (input.steeringText && input.steeringText.trim().length > 0) {
    layers.push({
      id: "active_state_steering",
      title: "Active State and Live Steering",
      content: input.steeringText,
      verbatim: false,
    });
  }

  // 9. Allowed outputs.
  const allowedOutputs = input.allowedOutputs ?? contract.allowedOutputs;
  layers.push({
    id: "allowed_outputs",
    title: "Allowed Outputs",
    content: allowedOutputsLayer(allowedOutputs),
    verbatim: false,
  });

  // 10. Approval and tool policy.
  layers.push({
    id: "approval_tool_policy",
    title: "Approval and Tool Policy",
    content: approvalPolicyLayer(input.approvalPolicy),
    verbatim: false,
  });

  // 11. Style guard (visible runs only).
  if (contract.visible && input.styleGuard.enabled) {
    layers.push({
      id: "style_guard",
      title: "Style Guard",
      content: styleGuardLayer(),
      verbatim: false,
    });
  }

  return {
    schemaVersion: 1,
    promptId: newId(),
    actorRunId: input.actorRunId,
    sessionId: input.sessionId,
    runType: input.runType,
    createdAt: nowIso(input.now),
    layers,
    allowedOutputs,
    styleGuard: input.styleGuard,
    approvalPolicy: input.approvalPolicy,
    platformCapabilities: input.platformCapabilities,
    contextRefs: input.contextRefs,
  };
}

/** Render a compiled packet into a single system-prompt string for a runtime. */
export function renderPromptPacket(packet: PromptPacket): string {
  return packet.layers
    .map((layer) => `## ${layer.title}\n${layer.content}`)
    .join("\n\n");
}

/**
 * Index of the verbatim base layer, used by audits/tests to assert placement
 * (must come after the runtime frame and before Param additions).
 */
export function verbatimLayerIndex(packet: PromptPacket): number {
  return packet.layers.findIndex(
    (layer) => layer.id === HUMAN_TEXT_AGENT_LAYER_ID,
  );
}
