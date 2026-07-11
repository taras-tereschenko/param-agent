import { describe, expect, test } from "bun:test";

import type { ToolHandler } from "../../src/tools/executor";
import {
  mapMcpToolToDefinition,
  type McpSourceLike,
  registerMcpTools,
} from "../../src/tools/mcp/client";
import { ToolRegistry } from "../../src/tools/registry";

function fakeSource(): McpSourceLike & {
  calls: { name: string; args: Record<string, unknown> }[];
} {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  return {
    calls,
    async listTools() {
      return [
        mapMcpToolToDefinition({ name: "get_page", description: "read" }, "web"),
        mapMcpToolToDefinition(
          { name: "delete_all", description: "danger" },
          "web",
        ),
      ];
    },
    async callTool(name, args) {
      calls.push({ name, args });
      if (name === "web.delete_all") return { content: null, isError: true };
      return { content: { ok: true }, isError: false };
    },
  };
}

describe("MCP tool registration + execution", () => {
  test("registers tools and executes via callTool", async () => {
    const registry = new ToolRegistry();
    const handlers = new Map<string, ToolHandler>();
    const source = fakeSource();

    await registerMcpTools(registry, handlers, [source]);

    expect(registry.has("web.get_page")).toBe(true);
    expect(registry.has("web.delete_all")).toBe(true);
    // safe-read name -> safe_read; unknown -> write (conservative default)
    expect(registry.get("web.get_page")?.riskLevel).toBe("safe_read");
    expect(registry.get("web.delete_all")?.riskLevel).toBe("write");

    const out = await handlers.get("web.get_page")!.execute({ url: "x" });
    expect(out).toEqual({ ok: true });
    expect(source.calls[0]).toEqual({
      name: "web.get_page",
      args: { url: "x" },
    });

    // An MCP error result surfaces as a thrown execution error.
    await expect(handlers.get("web.delete_all")!.execute({})).rejects.toThrow();
  });

  test("explicit risk override beats the name heuristic", async () => {
    const registry = new ToolRegistry();
    const handlers = new Map<string, ToolHandler>();
    await registerMcpTools(registry, handlers, [fakeSource()], {
      "web.get_page": "server",
    });
    expect(registry.get("web.get_page")?.riskLevel).toBe("server");
    expect(registry.get("web.get_page")?.approvalMode).toBe("review");
  });
});
