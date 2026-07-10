import {
  cancel,
  confirm,
  intro,
  isCancel,
  log,
  multiselect,
  note,
  outro,
  password,
  select,
  spinner,
  text,
} from "@clack/prompts";

import {
  buildDatabaseUrl,
  buildEnvFile,
  buildLocalConfigFile,
  detectHostPlatform,
  generateDbPassword,
  isRuntimeChoice,
  runtimeChoices,
  runtimeLabel,
  type HostPlatform,
  type RuntimeChoice,
  type SetupAnswers,
  writeIfMissing,
  writeSecretFileIfMissing,
} from "../src/ops/setup";

function stopIfCancel<T>(value: T | symbol): T {
  if (isCancel(value)) {
    cancel("setup cancelled");
    process.exit(0);
  }

  return value;
}

function validateTelegramUserId(value: string | undefined) {
  const input = value?.trim() ?? "";
  if (!input) return "owner Telegram user id is required";
  if (!/^-?\d+$/.test(input)) return "Telegram user id should be numeric";
  return undefined;
}

function validateTelegramBotToken(value: string | undefined) {
  const input = value?.trim() ?? "";
  if (!input) return "Telegram bot token is required";
  if (!/^\d+:[\w-]+$/.test(input)) {
    return "Telegram bot token usually looks like 123456:abc_def";
  }
  return undefined;
}

function validateRequired(label: string) {
  return (value: string | undefined) =>
    value && value.trim().length ? undefined : `${label} is required`;
}

// Empty is OK (a default applies); a non-empty value must be a valid port.
function validateOptionalPort(value: string | undefined) {
  const input = value?.trim() ?? "";
  if (!input) return undefined;
  const port = Number(input);
  if (!/^\d+$/.test(input) || port < 1 || port > 65535) {
    return "port must be a number between 1 and 65535";
  }
  return undefined;
}

// Bring-your-own database: collect the connection details as visible fields
// (host/port/name/user) plus a masked password, then assemble the URL — so the
// user never types a full URL blind or has to percent-encode anything.
async function collectExternalDatabaseUrl(): Promise<string> {
  const host = (
    stopIfCancel(
      await text({ message: "Database host", placeholder: "127.0.0.1" }),
    ) || "127.0.0.1"
  ).trim();
  const port = (
    stopIfCancel(
      await text({
        message: "Database port",
        placeholder: "5432",
        validate: validateOptionalPort,
      }),
    ) || "5432"
  ).trim();
  const database = (
    stopIfCancel(
      await text({ message: "Database name", placeholder: "param" }),
    ) || "param"
  ).trim();
  const user = (
    stopIfCancel(
      await text({ message: "Database user", placeholder: "param" }),
    ) || "param"
  ).trim();
  const dbPassword = stopIfCancel(
    await password({
      message: "Database password",
      mask: "•",
      validate: validateRequired("database password"),
    }),
  );

  return buildDatabaseUrl(dbPassword, { host, port, database, user });
}

function toRuntimeChoices(values: string[]) {
  return values.filter(isRuntimeChoice);
}

async function commandExists(command: string, platform: HostPlatform) {
  const lookup = platform === "windows" ? "where.exe" : "which";
  try {
    const proc = Bun.spawn([lookup, command], {
      stdout: "ignore",
      stderr: "ignore",
    });
    const exitCode = await proc.exited;
    return exitCode === 0;
  } catch {
    return false;
  }
}

async function checkSelectedRuntimes(
  runtimes: RuntimeChoice[],
  platform: HostPlatform,
) {
  const statuses = await Promise.all(
    runtimes.map(async (runtime) => ({
      runtime,
      installed: await commandExists(runtime, platform),
    })),
  );

  return statuses
    .map(({ runtime, installed }) => {
      const state = installed ? "found" : "not found";
      return `${runtimeLabel(runtime)}: ${state}`;
    })
    .join("\n");
}

async function collectAnswers(): Promise<SetupAnswers> {
  const ownerTelegramUserId = stopIfCancel(
    await text({
      message: "Owner Telegram user id",
      placeholder: "123456789",
      validate: validateTelegramUserId,
    }),
  ).trim();

  const telegramBotToken = stopIfCancel(
    await password({
      message: "Telegram bot token",
      mask: "*",
      validate: validateTelegramBotToken,
    }),
  ).trim();

  // Database: local (we generate a strong password — no prompt) vs external
  // (bring your own — ask for connection details). The bootstrap sets
  // PARAM_SETUP_DB_MODE; a standalone `bun run setup` asks.
  const dbMode =
    process.env.PARAM_SETUP_DB_MODE === "external"
      ? "external"
      : process.env.PARAM_SETUP_DB_MODE === "local"
        ? "local"
        : stopIfCancel(
            await select({
              message: "Database",
              initialValue: "local",
              options: [
                {
                  value: "local",
                  label:
                    "Set up a local Postgres for me (auto-generate the password)",
                },
                {
                  value: "external",
                  label: "Use an existing database (enter connection details)",
                },
              ],
            }),
          );

  let databaseUrl: string;
  if (dbMode === "external") {
    databaseUrl = await collectExternalDatabaseUrl();
  } else {
    databaseUrl = buildDatabaseUrl(generateDbPassword());
    log.info("Local Postgres: generated a strong password (saved in .env).");
  }

  const runtimes = toRuntimeChoices(
    stopIfCancel(
      await multiselect<string>({
        message: "Runtimes to enable/check",
        options: runtimeChoices.map((runtime) => ({
          value: runtime,
          label: runtimeLabel(runtime),
        })),
        initialValues: [...runtimeChoices],
        required: true,
      }),
    ),
  );

  const proceed = stopIfCancel(
    await confirm({
      message: "Create missing local config files?",
      initialValue: true,
    }),
  );

  if (!proceed) {
    cancel("setup cancelled before writing files");
    process.exit(0);
  }

  return {
    ownerTelegramUserId,
    telegramBotToken,
    databaseUrl,
    runtimes,
  };
}

async function main() {
  const hostPlatform = getSupportedHostPlatform();
  ensureInteractiveTerminal();

  intro("Param setup");

  note(
    `Detected host: ${hostPlatform}\n\nThis first setup pass creates local files only.\nIt will not install packages, create users, or start services yet.`,
    "scope",
  );

  const answers = await collectAnswers();

  const s = spinner();
  s.start("creating local files");

  const envResult = await writeSecretFileIfMissing(
    ".env",
    buildEnvFile(answers),
    hostPlatform,
  );
  const localConfigResult = await writeIfMissing(
    "param.config.local.ts",
    buildLocalConfigFile(answers),
  );

  s.stop("local setup files checked");

  log.info(
    [
      `${envResult.path}: ${envResult.action}`,
      `${localConfigResult.path}: ${localConfigResult.action}`,
    ].join("\n"),
  );

  const runtimeStatus = await checkSelectedRuntimes(
    answers.runtimes,
    hostPlatform,
  );
  note(runtimeStatus, "runtime check");

  outro("run `bun run doctor` next");
}

function getSupportedHostPlatform() {
  try {
    return detectHostPlatform();
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "unsupported host platform";
    cancel(message);
    process.exit(1);
  }
}

function ensureInteractiveTerminal() {
  if (process.stdin.isTTY && process.stdout.isTTY) {
    return;
  }

  console.error(
    [
      "Param setup is interactive in this implementation.",
      "Run it from an interactive terminal, or create .env and param.config.local.ts manually.",
      "Non-interactive installer flags belong to the future full installer slice.",
    ].join("\n"),
  );
  process.exit(1);
}

await main();

export {};
