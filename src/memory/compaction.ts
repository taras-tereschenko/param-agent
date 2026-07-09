/**
 * Compaction helpers. Compaction summarizes older context WITHOUT dropping the
 * recent raw tail: the context builder always includes summaries PLUS the
 * latest raw messages.
 */
export type CompactionInput<TEvent> = {
  events: TEvent[];
  /** Number of most-recent events to always keep raw. */
  tailSize: number;
};

export type CompactionPlan<TEvent> = {
  /** Events eligible to be summarized/compacted. */
  toCompact: TEvent[];
  /** The recent raw tail that must survive compaction. */
  rawTail: TEvent[];
};

/**
 * Split events into the range to compact and the recent raw tail to preserve.
 * The latest raw tail is never replaced by summary alone.
 */
export function planCompaction<TEvent>(
  input: CompactionInput<TEvent>,
): CompactionPlan<TEvent> {
  const tailSize = Math.max(0, input.tailSize);
  if (input.events.length <= tailSize) {
    return { toCompact: [], rawTail: input.events.slice() };
  }
  const cut = input.events.length - tailSize;
  return {
    toCompact: input.events.slice(0, cut),
    rawTail: input.events.slice(cut),
  };
}
