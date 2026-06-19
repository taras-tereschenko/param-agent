import { loadConfig } from "../src/config/load";
import { redactConfig } from "../src/config/redact";
import { assertRequiredConfigSecretRefsResolvable } from "../src/config/secrets";

const config = await loadConfig();
assertRequiredConfigSecretRefsResolvable(config);

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
