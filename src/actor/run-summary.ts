import type {
  ActorOutputDraft,
  RunSummaryOutputPayload,
} from "../contracts/actor-output";

export function extractRunSummary(
  drafts: ActorOutputDraft[],
): RunSummaryOutputPayload | undefined {
  const summary = drafts.find((d) => d.type === "run_summary");
  return summary?.type === "run_summary" ? summary.payload : undefined;
}

export function extractMemoryCandidates(drafts: ActorOutputDraft[]) {
  return drafts
    .filter((d) => d.type === "memory_candidate")
    .map((d) => (d.type === "memory_candidate" ? d.payload : undefined))
    .filter((p): p is NonNullable<typeof p> => p !== undefined);
}
