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
  spinner,
  text,
} from "@clack/prompts";

import {
  buildEnvFile,
  buildLocalConfigFile,
  detectHostPlatform,
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

function validateDatabaseUrl(value: string | undefined) {
  const input = value?.trim() ?? "";
  if (!input) return "DATABASE_URL is required";
  try {
    const url = new URL(input);
    if (!["postgres:", "postgresql:"].includes(url.protocol)) {
      return "DATABASE_URL must be a Postgres URL";
    }
  } catch {
    return "DATABASE_URL must be a valid URL";
  }

  return undefined;
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

  const databaseUrl = stopIfCancel(
    await text({
      message: "Database URL",
      initialValue: "postgresql://param:replace_me@127.0.0.1:5432/param",
      validate: validateDatabaseUrl,
    }),
  ).trim();

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

await main();

export {};
