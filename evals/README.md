# Param Evals

Scenario evals for social judgment, voice, memory, action-review, and steering
(docs/EVALS.md).

- `types.ts` — `EvalScenario` / `EvalResult` contracts.
- `scenarios/` — deterministic scenarios run against the MockActor (no live
  model). These gate voice + ambient behavior without external dependencies.
- `run.ts` — the runner (`bun run evals`). Exits non-zero on any failure.
- `rubrics/`, `reports/`, `fixtures/` — model-graded rubrics, run reports, and
  redacted replay fixtures are added here as the harness grows.

Deterministic scenarios must not depend on a live model, Telegram, or Postgres.
Model-graded scenario suites (which require a proven inference path) layer on
top of this harness and must keep deterministic safety assertions alongside any
model grader.
