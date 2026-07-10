import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";

import {
  buildEnvFile,
  buildLocalConfigFile,
  defaultHostPaths,
  detectHostPlatform,
  envValueRoundTrips,
  pickDefaultRuntime,
  serializeEnvValue,
  type SetupAnswers,
  writeSecretFileIfMissing,
} from "../../src/ops/setup";

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

  it("escapes $ so Bun's dotenv does not expand it in secrets", () => {
    // Bun expands $VAR / ${VAR} even inside quotes; a DB password like
    // `p4ss$word` must round-trip literally, not get mangled.
    expect(serializeEnvValue("p4ss$word-${X}")).toBe('"p4ss\\$word-\\${X}"');
    expect(serializeEnvValue("no-dollar-here")).toBe('"no-dollar-here"');
  });

  it("does not leave a spurious backslash on a trailing $", () => {
    // Bun keeps the backslash of a `\$` right before the closing quote, so a
    // trailing `$` must stay unescaped (it has nothing to expand). Only the
    // final $ of a run is unescaped; earlier ones stay escaped.
    expect(serializeEnvValue("abc$")).toBe('"abc$"');
    expect(serializeEnvValue("$")).toBe('"$"');
    expect(serializeEnvValue("ab$$")).toBe('"ab\\$$"');
    expect(serializeEnvValue("mid$dle$end$")).toBe('"mid\\$dle\\$end$"');
    // A value ending in $ round-trips, so the predicate must accept it.
    expect(envValueRoundTrips("abc$")).toBe(true);
  });

  it("flags values that would not survive the .env round-trip", () => {
    // $ is handled by serializeEnvValue, so it round-trips.
    expect(envValueRoundTrips("p4ss$word-${X}")).toBe(true);
    expect(
      envValueRoundTrips("postgresql://param:pa%22ss@127.0.0.1:5432/param"),
    ).toBe(true);
    expect(envValueRoundTrips("123456:abc_def-GHI")).toBe(true);
    // Bun keeps \" and \\ literal, so a raw quote/backslash does not round-trip.
    expect(envValueRoundTrips('postgresql://param:pa"ss@h/db')).toBe(false);
    expect(envValueRoundTrips("postgresql://param:pa\\ss@h/db")).toBe(false);
    expect(envValueRoundTrips("has\ttab")).toBe(false);
    // Lone surrogate: JSON.stringify emits \uXXXX, which Bun does not decode,
    // so it does not round-trip — the predicate must reject it. (Valid paired
    // surrogates / emoji are well-formed and accepted.)
    expect(envValueRoundTrips("\uD800")).toBe(false);
    expect(envValueRoundTrips("a\uDC00b")).toBe(false);
    expect(envValueRoundTrips("🔑-key")).toBe(true);
  });

  it("serialized secrets round-trip through Bun's real dotenv loader", async () => {
    // Self-validating: write serialized values to a real .env, read them back
    // in a fresh Bun process (auto-loads .env from cwd), and confirm each equals
    // the original — and that envValueRoundTrips agreed they would.
    const values = [
      "postgresql://param:p4ss$word@127.0.0.1:5432/param",
      "postgresql://param:pa%22ss@127.0.0.1:5432/param",
      "abc$",
      "ab$$",
      "mid$dle$end$",
      "a$(id)z",
      "a${HOME}z",
      "no-dollar-here",
      "123456:abc_def-GHI",
    ];
    const dir = await mkdtemp(join(tmpdir(), "param-rt-"));
    try {
      const lines = values
        .map((v, i) => `K${i}=${serializeEnvValue(v)}`)
        .join("\n");
      await Bun.write(join(dir, ".env"), `${lines}\n`);
      const reader = `const o=[];for(let i=0;i<${values.length};i++)o.push(process.env["K"+i]??"");process.stdout.write(JSON.stringify(o));`;
      const proc = Bun.spawnSync(["bun", "-e", reader], { cwd: dir });
      const back = JSON.parse(proc.stdout.toString()) as string[];

      values.forEach((v, i) => {
        expect(envValueRoundTrips(v)).toBe(true);
        expect(back[i]).toBe(v);
      });
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
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
