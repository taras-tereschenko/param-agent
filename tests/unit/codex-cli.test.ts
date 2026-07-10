import { describe, expect, test } from "bun:test";

import {
  CodexCliActor,
  type CliRunner,
} from "../../src/runtimes/codex/cli-actor";
import type { ActorInferenceRequest } from "../../src/actor/inference";

function request(): ActorInferenceRequest {
  return {
    promptPacket: {} as ActorInferenceRequest["promptPacket"],
    renderedPrompt: "you are param. someone said hey.",
    runType: "normal_chat",
    allowedOutputs: ["message", "no_reply", "done"],
  };
}

function runnerReturning(stdout: string, exitCode = 0): CliRunner {
  return async ({ args }) => {
    // `--version` availability probe.
    if (args.includes("--version")) {
      return { stdout: "codex 1.0.0", stderr: "", exitCode: 0 };
    }
    return { stdout, stderr: "", exitCode };
  };
}

describe("CodexCliActor", () => {
  test("parses a valid JSON output array into drafts", async () => {
    const actor = new CodexCliActor({
      runner: runnerReturning(
        '[{"type":"message","payload":{"text":"yo"}},{"type":"done","payload":{"status":"completed"}}]',
      ),
    });
    expect(await actor.isAvailable()).toBe(true);
    const res = await actor.run(request());
    expect(res.provider).toBe("codex-cli");
    expect(res.drafts.map((d) => d.type)).toEqual(["message", "done"]);
  });

  test("strips a code fence around the JSON", async () => {
    const actor = new CodexCliActor({
      runner: runnerReturning(
        '```json\n[{"type":"no_reply","payload":{"reason":"not_my_moment"}},{"type":"done","payload":{"status":"completed"}}]\n```',
      ),
    });
    const res = await actor.run(request());
    expect(res.drafts[0]?.type).toBe("no_reply");
  });

  test("unparseable output degrades to a safe no_reply, never crashes", async () => {
    const actor = new CodexCliActor({
      runner: runnerReturning("sure! here is what I think: (not json)"),
    });
    const res = await actor.run(request());
    expect(res.drafts.map((d) => d.type)).toEqual(["no_reply", "done"]);
  });

  test("non-zero exit degrades to a safe no_reply", async () => {
    const actor = new CodexCliActor({ runner: runnerReturning("", 1) });
    const res = await actor.run(request());
    expect(res.drafts.map((d) => d.type)).toEqual(["no_reply", "done"]);
  });

  test("a thrown runner (missing binary) is caught -> stays quiet", async () => {
    const actor = new CodexCliActor({
      runner: async ({ args }) => {
        if (args.includes("--version")) {
          return { stdout: "", stderr: "", exitCode: 0 };
        }
        throw new Error("ENOENT");
      },
    });
    const res = await actor.run(request());
    expect(res.drafts.map((d) => d.type)).toEqual(["no_reply", "done"]);
  });

  test("isAvailable is false when the version probe throws", async () => {
    const actor = new CodexCliActor({
      runner: async () => {
        throw new Error("ENOENT");
      },
    });
    expect(await actor.isAvailable()).toBe(false);
  });
});
