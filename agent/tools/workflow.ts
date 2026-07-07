// Enable Eve's experimental Workflow tool so Param can durably orchestrate its
// subagents (e.g. the researcher, or copies of itself) as one durable step:
// fan-out, feed one result into the next, and combine. The orchestration runs in
// an isolated QuickJS sandbox with no file, network, shell, or env access; it can
// only call this agent's subagents.
export { ExperimentalWorkflow as default } from "eve/tools";
