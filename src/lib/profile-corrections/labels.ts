import type { ProfileCorrectionStatus } from "@/lib/db/schema/profile-corrections";

/** How a correction's status reads to the employee and to HR (W2-02). */
export const PROFILE_CORRECTION_STATUS_LABELS: Record<
  ProfileCorrectionStatus,
  string
> = {
  pendiente: "En revisión",
  aplicada: "Corregido",
  rechazada: "Rechazada",
  cancelada: "Cancelada",
};

/** Longest proposed value, note and rejection reason (checks in migration 0038). */
export const PROFILE_CORRECTION_LIMITS = {
  value: 300,
  note: 500,
  reason: 500,
} as const;
