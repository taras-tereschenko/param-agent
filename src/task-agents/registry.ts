export type TaskAgentType =
  | "research"
  | "coding"
  | "image"
  | "browser"
  | "memory"
  | "cli"
  | "server";

export type TaskAgentDef = {
  type: TaskAgentType;
  runtime: string;
  description: string;
  defaultTools: string[];
  available: boolean;
  unavailableReason?: string;
};

/**
 * Built-in task agent types. Image and browser are placeholders (their runtimes
 * are not configured by default) and report unavailable rather than failing
 * loudly. Task agents report back to the Session Actor, never directly to chat.
 */
export const defaultTaskAgents: TaskAgentDef[] = [
  {
    type: "research",
    runtime: "codex",
    description: "model-backed research helper",
    defaultTools: ["system.time"],
    available: true,
  },
  {
    type: "coding",
    runtime: "codex",
    description: "coding/patch generation helper",
    defaultTools: [],
    available: true,
  },
  {
    type: "memory",
    runtime: "mock",
    description: "memory review helper",
    defaultTools: [],
    available: true,
  },
  {
    type: "server",
    runtime: "codex",
    description: "server-management planning helper (behind Action Review)",
    defaultTools: ["service.status", "logs.tail"],
    available: true,
  },
  {
    type: "cli",
    runtime: "opencode",
    description: "custom CLI helper",
    defaultTools: [],
    available: true,
  },
  {
    type: "image",
    runtime: "image",
    description: "image generation helper (placeholder)",
    defaultTools: [],
    available: false,
    unavailableReason: "image runtime not configured",
  },
  {
    type: "browser",
    runtime: "browser",
    description: "browser automation helper (placeholder)",
    defaultTools: [],
    available: false,
    unavailableReason: "browser runtime not configured",
  },
];

export class TaskAgentRegistry {
  private readonly defs = new Map<string, TaskAgentDef>();

  constructor(defs: TaskAgentDef[] = defaultTaskAgents) {
    for (const def of defs) {
      this.defs.set(def.type, def);
    }
  }

  get(type: string): TaskAgentDef | undefined {
    return this.defs.get(type);
  }

  list(): TaskAgentDef[] {
    return [...this.defs.values()];
  }

  isAvailable(type: string): boolean {
    return this.defs.get(type)?.available ?? false;
  }
}
