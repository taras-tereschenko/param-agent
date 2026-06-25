export const MEMORY_CATEGORIES = [
  "user_profile",
  "user_preferences",
  "chat_profile",
  "group_norms",
  "projects",
  "relationships",
  "recurring_tasks",
  "long_running_context",
] as const;

export type MemoryCategory = (typeof MEMORY_CATEGORIES)[number];
