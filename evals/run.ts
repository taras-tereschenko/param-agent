import { MockActor } from "../src/actor/mock-actor";
import { runActorTurn } from "../src/actor/runner";
import type {
  PlatformCapabilitySummary,
  PromptApprovalPolicy,
  StyleGuardPolicy,
} from "../src/contracts/prompt";
import { ambientVoiceScenarios } from "./scenarios/ambient-voice";
import type { EvalResult, EvalScenario } from "./types";

const platform: PlatformCapabilitySummary = {
  platform: "telegram",
  supportsText: true,
  supportsReactions: true,
  availableReactions: ["👍"],
  supportsReplies: true,
  supportsFiles: true,
  supportsInlineButtons: true,
  supportsRichMessage: true,
  supportsMiniApps: false,
};
const styleGuard: StyleGuardPolicy = {
  version: "style_guard:param_chat_v1",
  enabled: true,
  rewriteOnFailure: true,
  maxVisibleMessagesPerRun: 6,
};
const approvalPolicy: PromptApprovalPolicy = {
  requireApprovalForConsequential: true,
  safeAutoRunTools: [],
};

export async function runScenario(
  scenario: EvalScenario,
): Promise<EvalResult> {
  const turn = await runActorTurn(new MockActor(), {
    actorRunId: `eval-${scenario.id}`,
    sessionId: "eval-session",
    runType: scenario.runType,
    platformCapabilities: platform,
    styleGuard,
    approvalPolicy,
    knownEventIds: scenario.latest?.latestEventId
      ? [scenario.latest.latestEventId]
      : [],
    latest: scenario.latest,
  });
  const error = scenario.expect({
    visibleMessages: turn.visibleMessages.map((m) => ({ text: m.text })),
    stayedQuiet: turn.stayedQuiet,
  });
  return { id: scenario.id, passed: error === null, error: error ?? undefined };
}

export async function runAllScenarios(): Promise<EvalResult[]> {
  const scenarios = [...ambientVoiceScenarios];
  const results: EvalResult[] = [];
  for (const scenario of scenarios) {
    results.push(await runScenario(scenario));
  }
  return results;
}

if (import.meta.main) {
  const results = await runAllScenarios();
  for (const result of results) {
    console.log(
      `${result.passed ? "PASS" : "FAIL"} ${result.id}${result.error ? ` — ${result.error}` : ""}`,
    );
  }
  const failed = results.filter((r) => !r.passed).length;
  console.log(`\n${results.length - failed}/${results.length} scenarios passed`);
  if (failed > 0) {
    process.exitCode = 1;
  }
}
