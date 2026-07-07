import { defineAgent } from "eve";

export default defineAgent({
  description:
    "Research helper. Investigates a question with web search and returns a concise, sourced summary to Param. Delegate to it for background research when a quick answer is not enough. It never talks to chats.",
  model: process.env.PARAM_EVE_MODEL ?? "openai/gpt-5.4-mini",
});
