/**
 * Smoke-test the Session Actor brain end-to-end WITHOUT the worker/DB/Telegram.
 *
 *   bun run brain:check            # uses PARAM_ACTOR / OPENAI_API_KEY from .env
 *
 * It builds the same actor resolveInference would pick for a real turn, sends a
 * tiny "say hi" prompt, and prints the outputs. Use it to confirm the brain
 * actually replies (and to see the real provider error if it doesn't) before
 * trusting the live service.
 */
import type { ActorInferenceRequest } from "../src/actor/inference";
import { CodexCliActor } from "../src/runtimes/codex/cli-actor";
import { OpenAiApiActor } from "../src/runtimes/openai/api-actor";

// || not ??: .env writes `PARAM_ACTOR=` (empty), which `??` would NOT default,
// leaving mode="" that matches no branch (the openai/codex selection below).
const mode = (Bun.env.PARAM_ACTOR?.trim() || "auto").toLowerCase();

function pickActor() {
  const openai = new OpenAiApiActor();
  if ((mode === "auto" || mode === "openai") && openai.isAvailable()) {
    return openai;
  }
  if (mode === "codex" || mode === "auto") {
    return new CodexCliActor({ command: "codex", args: ["exec"] });
  }
  return openai; // let isAvailable/run report the problem
}

const actor = pickActor();

if (!(await actor.isAvailable())) {
  console.error(
    `brain "${actor.name}" is not available — set OPENAI_API_KEY in .env (or install/auth codex, or set PARAM_ACTOR).`,
  );
  process.exit(1);
}

const request = {
  renderedPrompt: [
    "You are Param, a warm, low-key chat companion (not an assistant).",
    'A friend just messaged you: "hey, you around?"',
    "Reply with one short, natural message.",
  ].join("\n"),
  promptPacket: { layers: [] },
  runType: "normal_chat",
  allowedOutputs: ["message", "no_reply", "done"],
} as unknown as ActorInferenceRequest;

console.log(`brain: ${actor.name} — sending a test turn...`);
const result = await actor.run(request);
console.log(`provider: ${result.provider}`);
console.log(JSON.stringify(result.drafts, null, 2));

const message = result.drafts.find((d) => d.type === "message");
if (message && message.type === "message") {
  console.log(`\nOK — the brain replied: ${JSON.stringify(message.payload.text)}`);
} else {
  console.error(
    "\nThe brain produced no message (only a no_reply/fallback). If an error was logged above, that's why — fix it before starting the service.",
  );
  process.exit(2);
}
