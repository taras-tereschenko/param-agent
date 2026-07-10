import type { LatestContext } from "../src/actor/inference";
import type { PromptRunType } from "../src/contracts/prompt";

/**
 * A deterministic scenario eval (docs/EVALS.md). Model-graded scenario suites
 * are layered on top of this harness; these deterministic checks gate voice and
 * behavior without a live model.
 */
export type EvalScenario = {
  id: string;
  description: string;
  runType: PromptRunType;
  latest?: LatestContext;
  /** Assertions over the actor turn result; return an error string or null. */
  expect: (result: EvalTurn) => string | null;
};

export type EvalTurn = {
  visibleMessages: { text: string }[];
  stayedQuiet: boolean;
};

export type EvalResult = {
  id: string;
  passed: boolean;
  error?: string;
};
