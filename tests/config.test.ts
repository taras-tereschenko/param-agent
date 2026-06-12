import { describe, expect, test } from "bun:test";
import { paramConfigSchema } from "../src/config/schema";

describe("config schema", () => {
  test("rejects invalid app environment", () => {
    const result = paramConfigSchema.safeParse({
      app: {
        name: "Param",
        environment: "space",
        timezone: "Asia/Tashkent",
      },
    });

    expect(result.success).toBe(false);
  });
});

