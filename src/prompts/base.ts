import { readFileSync } from "node:fs";

import { sha256Hex } from "../shared/json";

/**
 * The immutable base of Param's visible-chat system prompt.
 *
 * `human-text-agent-prompt.txt` MUST be included verbatim in visible Session
 * Actor runs. It is never summarized, rewritten, reordered, trimmed, or edited.
 * Param-specific instructions are added only AFTER it (see layers.ts).
 *
 * The file is read from disk at module load so the running system always uses
 * exactly what is committed. A test asserts the loaded bytes match the file.
 */
const promptUrl = new URL("./human-text-agent-prompt.txt", import.meta.url);

export const humanTextAgentPrompt: string = readFileSync(promptUrl, "utf8");

export const humanTextAgentPromptHash: string = sha256Hex(humanTextAgentPrompt);

/** Layer id for the verbatim base. */
export const HUMAN_TEXT_AGENT_LAYER_ID = "human_text_agent_prompt";
