const target = "param.config.local.ts";

const template = `// Local Param config overrides.
//
// This file is ignored by git.
// Put per-instance non-secret settings here.
//
// Good examples:
// - local paths
// - enabled runtimes
// - scheduler limits
// - Telegram polling/webhook mode
// - non-secret labels and feature flags
//
// Do not put secrets here.
// Put bot tokens, database URLs, and API keys in .env.

import type { ParamConfigOverride } from "./src/config/schema";

export default {
  // Example:
  // app: {
  //   timezone: "Asia/Tashkent",
  // },
} satisfies ParamConfigOverride;
`;

const existing = await Bun.file(target).exists();

if (existing) {
  console.log(`${target} already exists`);
  process.exit(0);
}

await Bun.write(target, template);
console.log(`created ${target}`);

export {};
