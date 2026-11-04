import type { TodayRow } from "./today";

export type TodayStatus = "absent" | "on_shift" | "left" | "pending";

export type TodayIncidencia = {
  kind: string;
  minutes: number | null;
  justified: boolean;
};

/**
 * The day's incidencias in force: per kind, the highest payload.rev wins and
 * a voided one cancels it (the P-02 correction contract, docs/aggregates.md).
 */
export const incidenciasInForce = (
  rows: TodayRow["incidencias"],
): TodayIncidencia[] => {
  const latest = new Map<string, Record<string, unknown>>();

  for (const row of rows) {
    const kind = typeof row.payload.kind === "string" ? row.payload.kind : null;
    if (!kind) continue;
    const seen = latest.get(kind);
    const rev = Number(row.payload.rev ?? 0);
    if (!seen || rev >= Number(seen.rev ?? 0)) latest.set(kind, row.payload);
  }

  return [...latest.entries()]
    .filter(([, payload]) => payload.voided !== true)
    .map(([kind, payload]) => ({
      kind,
      minutes: typeof payload.minutes === "number" ? payload.minutes : null,
      justified: payload.justified === true,
    }));
};

/**
 * One person's state on the today screen: a falta wins, then the last punch
 * (an entry is on shift, an exit is gone for the day), and with neither it is
 * pending: nothing has arrived for them yet.
 */
export const todayStatus = (
  row: Pick<TodayRow, "attendance" | "incidencias">,
): {
  status: TodayStatus;
  firstIn: string | null;
  lastOut: string | null;
  incidencias: TodayIncidencia[];
} => {
  const incidencias = incidenciasInForce(row.incidencias);
  const stored = Array.isArray(row.attendance?.punches)
    ? (row.attendance.punches as Array<[string, string, string?]>)
    : [];
  const firstIn = stored.find(([, kind]) => kind === "in")?.[0] ?? null;
  const lastOut = stored.findLast(([, kind]) => kind === "out")?.[0] ?? null;
  const lastKind = stored.at(-1)?.[1];

  const status: TodayStatus = incidencias.some((item) => item.kind === "falta")
    ? "absent"
    : lastKind === "in"
      ? "on_shift"
      : lastKind === "out"
        ? "left"
        : row.attendance
          ? "on_shift"
          : "pending";

  return { status, firstIn, lastOut, incidencias };
};
