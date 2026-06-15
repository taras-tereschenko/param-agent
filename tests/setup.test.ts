import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";

import {
  buildEnvFile,
  buildLocalConfigFile,
  defaultHostPaths,
  detectHostPlatform,
  pickDefaultRuntime,
  serializeEnvValue,
  type SetupAnswers,
  writeSecretFileIfMissing,
} from "../src/ops/setup";

const answers: SetupAnswers = {
  ownerTelegramUserId: "123456789",
  telegramBotToken: "123456:secret_token",
  databaseUrl: "postgresql://param:secret@127.0.0.1:5432/param",
  runtimes: ["codex", "antigravity"],
};

describe("setup file generation", () => {
  it("writes quoted secrets and machine values to env content", () => {
    const env = buildEnvFile(answers);

    expect(env).toContain('TELEGRAM_BOT_TOKEN="123456:secret_token"');
    expect(env).toContain('PARAM_OWNER_TELEGRAM_USER_ID="123456789"');
    expect(env).toContain(
      'DATABASE_URL="postgresql://param:secret@127.0.0.1:5432/param"',
    );
  });

  it("serializes env values that would otherwise break dotenv parsing", () => {
    expect(serializeEnvValue('abc # "quoted" \\ path')).toBe(
      '"abc # \\"quoted\\" \\\\ path"',
    );
  });

  it("keeps secrets out of local config content", () => {
    const localConfig = buildLocalConfigFile(answers);

    expect(localConfig).not.toContain("123456:secret_token");
    expect(localConfig).not.toContain("postgresql://param:secret");
    expect(localConfig).not.toContain("123456789");
  });

  it("sets runtime enabled flags from selected runtimes", () => {
    const localConfig = buildLocalConfigFile(answers);

    expect(localConfig).toContain("defaultRuntime: \"codex\"");
    expect(localConfig).toContain("codex: {\n      enabled: true");
    expect(localConfig).toContain("opencode: {\n      enabled: false");
    expect(localConfig).toContain("antigravity: {\n      enabled: true");
  });

  it("prefers codex as default runtime when selected", () => {
    expect(pickDefaultRuntime(["opencode", "codex"])).toBe("codex");
  });

  it("falls back to first selected runtime when codex is not selected", () => {
    expect(pickDefaultRuntime(["antigravity", "opencode"])).toBe(
      "antigravity",
    );
  });

  it("requires at least one runtime", () => {
    expect(() => pickDefaultRuntime([])).toThrow(
      "at least one runtime must be selected",
    );
  });

  it("detects supported host platforms", () => {
    expect(detectHostPlatform("linux")).toBe("linux");
    expect(detectHostPlatform("darwin")).toBe("macos");
    expect(detectHostPlatform("win32")).toBe("windows");
  });

  it("rejects unsupported host platforms", () => {
    expect(() => detectHostPlatform("freebsd")).toThrow(
      "unsupported host platform: freebsd",
    );
  });

  it("builds host-local paths for each supported platform", () => {
    expect(
      defaultHostPaths("linux", {
        HOME: "/home/param",
        XDG_DATA_HOME: "/data",
        XDG_STATE_HOME: "/state",
      }).dataDir,
    ).toBe("/data/param-agent");

    expect(
      defaultHostPaths("macos", {
        HOME: "/Users/param",
      }).dataDir,
    ).toBe("/Users/param/Library/Application Support/Param Agent");

    expect(
      defaultHostPaths("windows", {
        LOCALAPPDATA: "C:\\Users\\param\\AppData\\Local",
      }).dataDir,
    ).toBe("C:\\Users\\param\\AppData\\Local\\Param Agent\\Data");
  });

  it("creates secret files with restrictive POSIX permissions", async () => {
    const dir = await mkdtemp(join(tmpdir(), "param-setup-"));
    const envPath = join(dir, ".env");

    try {
      const created = await writeSecretFileIfMissing(
        envPath,
        "TOKEN=secret\n",
        "linux",
      );
      expect(created.action).toBe("created");

      const mode = (await stat(envPath)).mode & 0o777;
      expect(mode).toBe(0o600);

      const skipped = await writeSecretFileIfMissing(
        envPath,
        "TOKEN=other\n",
        "linux",
      );
      expect(skipped.action).toBe("skipped");
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  });
});
