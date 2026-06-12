import { loadConfig } from "../config/load";
import { redactConfig } from "../config/redact";

const config = await loadConfig();

console.log(
  JSON.stringify({
    ok: true,
    service: "param-worker",
    config: redactConfig(config),
  }),
);

