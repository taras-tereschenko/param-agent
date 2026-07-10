import { describe, expect, test } from "bun:test";

import { runAllScenarios } from "../../evals/run";

describe("eval scenarios", () => {
  test("all deterministic scenarios pass", async () => {
    const results = await runAllScenarios();
    const failed = results.filter((r) => !r.passed);
    expect(failed.map((f) => `${f.id}: ${f.error}`)).toEqual([]);
    expect(results.length).toBeGreaterThan(0);
  });
});
