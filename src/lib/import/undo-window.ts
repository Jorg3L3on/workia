import { env } from "@/env";

/** Whether an import applied at `appliedAt` can still be undone by time. */
export const isUndoWindowOpen = (appliedAt: Date | null) =>
  appliedAt !== null &&
  Date.now() - appliedAt.getTime() < env.IMPORT_UNDO_WINDOW_HOURS * 3_600_000;
