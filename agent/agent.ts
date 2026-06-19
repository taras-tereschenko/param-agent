import { defineAgent } from "eve";

export default defineAgent({
  model: process.env.PARAM_EVE_MODEL ?? "openai/gpt-5.4-mini",
});
