import { loadConfig } from "./load";
import { redactConfig } from "./redact";

const config = await loadConfig();

console.log(JSON.stringify(redactConfig(config), null, 2));

