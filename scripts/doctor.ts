import { loadConfig } from "../src/config/load";
import { redactConfig } from "../src/config/redact";

const config = await loadConfig();

console.log(
  JSON.stringify(
    {
      ok: true,
      config: redactConfig(config),
    },
    null,
    2,
  ),
);

