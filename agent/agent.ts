import { codexExec } from "ai-sdk-provider-codex-cli";
import { defineAgent } from "eve";

// Param's inference runs through your Codex (ChatGPT Plus/Pro) subscription via
// the Codex CLI, using the ai-sdk-provider-codex-cli community provider — not
// the paid AI Gateway. Requires the Codex CLI installed and logged in
// (`npm i -g @openai/codex && codex login`; tokens in ~/.codex/auth.json)
// wherever Param runs, so Param runs self-hosted / `eve start`, not a serverless
// function.
// Security: Codex is an agent with shell/file access, and as Param's model it
// sits behind chat input, so a crafted or injected prompt could otherwise make
// it run commands or write files on the host — bypassing Param's own Action
// Review. Confine it to read-only with no autonomous approvals so it can only
// read and reason, never act on the machine.
const model = codexExec(process.env.PARAM_CODEX_MODEL ?? "gpt-5.5", {
  approvalMode: "never",
  sandboxMode: "read-only",
  skipGitRepoCheck: true,
});

export default defineAgent({
  model,
  // Codex models aren't in the AI Gateway catalog, so give compaction the
  // context window explicitly instead of relying on a gateway lookup.
  modelContextWindowTokens: Number(process.env.PARAM_CODEX_CONTEXT_WINDOW ?? "272000"),
});
