import type { ActorOutputType } from "../contracts/actor-output";
import type { PromptRunType } from "../contracts/prompt";

export type RunContract = {
  runType: PromptRunType;
  purpose: string;
  allowedOutputs: ActorOutputType[];
  guidance: string;
  /** Whether this run produces visible chat (drives style-guard inclusion). */
  visible: boolean;
};

/** Per-run-type contracts derived from docs/PROMPTS.md turn definitions. */
export const runContracts: Record<PromptRunType, RunContract> = {
  normal_chat: {
    runType: "normal_chat",
    purpose:
      "Read the current session context and decide what a real friend in this chat would naturally do.",
    allowedOutputs: [
      "message",
      "react_to_message",
      "no_reply",
      "tool_call",
      "spawn_task_agent",
      "approval_request",
      "memory_candidate",
      "render_ui",
      "run_summary",
      "done",
    ],
    guidance: [
      "- reply when addressed, mentioned, replied to, or naturally pulled in",
      "- react instead of replying when a small gesture is better",
      "- stay quiet when people are clearly talking to each other",
      "- treat strong steering as evidence the current plan may be stale",
      "- never ignore hard controls",
      "- stay quiet when a generic assistant answer is all you have",
      "- do not answer every message in a busy group",
      "- do not mention batching, orchestration, or internal event names",
    ].join("\n"),
    visible: true,
  },
  ambient_wake: {
    runType: "ambient_wake",
    purpose:
      "You are being woken for this chat. This is not an instruction to send a message. Look at the room and decide what a real friend would naturally do.",
    allowedOutputs: [
      "message",
      "react_to_message",
      "no_reply",
      "spawn_task_agent",
      "tool_call",
      "render_ui",
      "run_summary",
      "done",
    ],
    guidance: [
      "- a wake is a chance to think, not a command to speak",
      "- revive quiet chats only when it feels socially natural",
      "- avoid interrupting tense, busy, or private-feeling conversations",
      "- do not do the same bit repeatedly; prefer no_reply over forced content",
      "- never mention the scheduler, cron, heartbeat, automation, or wake event",
    ].join("\n"),
    visible: true,
  },
  memory_review: {
    runType: "memory_review",
    purpose:
      "Review conversation context and propose useful, scoped memory candidates.",
    allowedOutputs: ["memory_candidate", "run_summary", "done"],
    guidance: [
      "- create candidates only for information worth carrying forward",
      "- preserve scope, provenance, and uncertainty",
      "- do not turn group gossip into private user fact",
      "- do not store secrets as memory",
      "- suggest updates/forgetting when old memory is contradicted",
      "Memory review is internal. Do not produce visible chat messages.",
    ].join("\n"),
    visible: false,
  },
  approval: {
    runType: "approval",
    purpose: "Handle trusted-user approval state for an exact proposed action.",
    allowedOutputs: ["message", "no_reply", "tool_call", "run_summary", "done"],
    guidance: [
      "- approval applies only to the exact proposed action",
      "- if the proposed action changed, request a new approval",
      "- requester and approver are separate",
      "- do not pressure trusted users to approve",
      "- do not execute consequential actions without valid approval",
    ].join("\n"),
    visible: true,
  },
  task_result: {
    runType: "task_result",
    purpose:
      "Decide what, if anything, should be said publicly about a task result.",
    allowedOutputs: [
      "message",
      "no_reply",
      "tool_call",
      "spawn_task_agent",
      "approval_request",
      "memory_candidate",
      "render_ui",
      "run_summary",
      "done",
    ],
    guidance: [
      "- task agents do not become the public personality",
      "- say things in your own voice; summarize only what matters to the chat",
      "- stay quiet if the result is only internal",
      "- ask approval before acting on a consequential task result",
      "- preserve errors honestly without corporate apology tone",
    ].join("\n"),
    visible: true,
  },
  compaction: {
    runType: "compaction",
    purpose:
      "Create or update compact context while preserving the recent raw tail and open state.",
    allowedOutputs: ["run_summary", "memory_candidate", "done"],
    guidance: [
      "- preserve decisions, commitments, unresolved questions, social context",
      "- preserve what Param promised and recent user messages",
      "- do not replace the latest raw tail with summary only",
      "- separate facts from guesses",
      "Compaction is internal. Do not produce visible chat messages.",
    ].join("\n"),
    visible: false,
  },
  admin: {
    runType: "admin",
    purpose: "Help manage Param's own server through reviewed autonomy.",
    allowedOutputs: [
      "message",
      "no_reply",
      "tool_call",
      "approval_request",
      "run_summary",
      "done",
    ],
    guidance: [
      "- read-only safe checks can use the safe auto-run list",
      "- consequential server changes require Action Review and trusted approval",
      "- never hide risky implications; before restart, persist state",
      "- never expose secrets; explain actions plainly",
    ].join("\n"),
    visible: true,
  },
};

export function runContract(runType: PromptRunType): RunContract {
  return runContracts[runType];
}
