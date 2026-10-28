/**
 * The one map from a record's status to a Badge tone. Tone encodes meaning,
 * not module:
 * - success: the record is in its good state (Activa, Vigente, Asignado).
 * - warning: needs a decision soon (Por vencer, En revisión).
 * - danger: overdue or blocked (Vencido, Rechazada, Suspendida).
 * - info: in progress, nobody is late (Pendiente Nóminas, Nueva).
 * - neutral: closed or parked (Baja, Inactivo, En almacén, Revocada).
 */
export type Tone = "success" | "warning" | "danger" | "info" | "neutral";

export const statusTone = {
  person: { activa: "success", baja: "neutral" },
  contract: {
    vigente: "success",
    renovado: "neutral",
    no_renovado: "neutral",
    vencido: "danger",
    // Ended by the person's baja: closed, not overdue.
    terminado: "neutral",
  },
  renewal: { vencido: "danger", proximo: "warning", en_ventana: "neutral" },
  company: { activa: "success", suspendida: "danger" },
  membership: { activa: "success", revocada: "neutral" },
  onboarding: {
    rh_captura: "info",
    pendiente_nominas: "info",
    completo: "success",
    rechazado: "danger",
  },
  asset: { disponible: "neutral", asignado: "success", baja: "neutral" },
  connection: { activa: "success", vencida: "danger", revocada: "neutral" },
  toolCall: { success: "success", denied: "warning", error: "danger" },
  importJob: {
    uploading: "info",
    validating: "info",
    in_review: "warning",
    applying: "info",
    applied: "success",
    failed: "danger",
    undone: "neutral",
  },
  document: {
    missing: "info",
    valid: "success",
    expiring: "warning",
    expired: "danger",
  },
} as const satisfies Record<string, Record<string, Tone>>;

export type StatusKind = keyof typeof statusTone;

/** Tone for a status value; unknown values read as neutral. */
export const toneFor = <K extends StatusKind>(kind: K, status: string): Tone =>
  (statusTone[kind] as Record<string, Tone>)[status] ?? "neutral";

/** Catalog rows, templates and anything with an active flag. */
export const activeTone = (active: boolean): Tone =>
  active ? "success" : "neutral";

/** A soft-deleted record (expediente, área): closed, so neutral. */
export const deletedTone: Tone = "neutral";
