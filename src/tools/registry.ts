import {
  toolDefinitionSchema,
  type ToolApprovalMode,
  type ToolDefinition,
  type ToolRiskLevel,
} from "../contracts/tool";
import { validationError } from "../shared/errors";

/** Compact per-tool metadata exposed to the actor for tool selection. */
export interface ActorToolMetadata {
  name: string;
  description: string;
  riskLevel: ToolRiskLevel;
  approvalMode: ToolApprovalMode;
}

/**
 * In-memory registry of `ToolDefinition`s keyed by name. Definitions are
 * validated with `toolDefinitionSchema` on registration and duplicate names
 * are rejected.
 */
export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();

  register(def: ToolDefinition): ToolDefinition {
    const parsed = toolDefinitionSchema.parse(def);
    if (this.tools.has(parsed.name)) {
      throw validationError(`Tool already registered: ${parsed.name}`, {
        name: parsed.name,
      });
    }
    this.tools.set(parsed.name, parsed);
    return parsed;
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  list(): ToolDefinition[] {
    return [...this.tools.values()];
  }

  listForActor(): ActorToolMetadata[] {
    return this.list().map((def) => ({
      name: def.name,
      description: def.description,
      riskLevel: def.riskLevel,
      approvalMode: def.approvalMode,
    }));
  }
}
