import { inArray } from "drizzle-orm";
import { z } from "zod";

import { tdb } from "@/lib/db";
import { people, sites } from "@/lib/db/schema";
import { formatPersonName } from "@/lib/people/schema";
import {
  loadPayPeriodIncidencias,
  verifyPeriodSnapshot,
} from "@/lib/pay-periods";
import { incidenciaKindLabel } from "@/lib/pay-periods/copy";
import { withTenant } from "@/lib/tenant/scope";
import {
  absenteeismBy,
  AggregateRangeError,
  incidenciasBy,
} from "@/lib/timeline/aggregates";

import {
  cursorSchema,
  decodeCursor,
  filtersHash,
  limitSchema,
  pageOf,
} from "../cursor";
import { McpToolError } from "../errors";
import { defineTool, readAnnotations } from "../run-tool";
import { appUrl, isoDate, mx, nextCursorSchema, uuid } from "./common";

/**
 * Read-only tools over the numbers every screen shows (Workia 2.0 W2-15):
 * the P-02 aggregates computed from person_events when read, and the
 * incidencias a closed quincena froze for pre-nómina. No counters.
 */

const kindTotalsSchema = z.object({
  kind: z.string(),
  kind_label: z.string(),
  count: z.number().int().describe("Días con esta incidencia."),
  justified: z.number().int().describe("De esos, justificados."),
  minutes: z
    .number()
    .int()
    .describe("Minutos sumados (retardo, salida anticipada)."),
});

const kindsOf = (
  kinds: Record<string, { count: number; justified: number; minutes: number }>,
) =>
  Object.entries(kinds)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([kind, value]) => ({
      kind,
      kind_label: incidenciaKindLabel(kind),
      ...value,
    }));

const KEY_AFTER = (
  after: { key: string; id: string } | null,
  row: { label: string; id: string },
) =>
  !after ||
  row.label > after.key ||
  (row.label === after.key && row.id > after.id);

const validation = (error: unknown): never => {
  if (error instanceof AggregateRangeError) {
    throw new McpToolError("VALIDATION", error.message);
  }

  throw error;
};

export const getIncidenciasSummaryTool = defineTool({
  name: "get_incidencias_summary",
  title: "Incidencias y ausentismo",
  description:
    "Incidencias (faltas, retardos, salidas anticipadas) y ausentismo de un rango de días, agrupados por persona, sucursal o mes. Son los mismos números que muestran las pantallas, calculados al consultar a partir de la asistencia y las incidencias registradas: no son los de un cierre. Para lo congelado de una quincena cerrada usa get_pay_period. Ausentismo = faltas / (días con asistencia + faltas). Rango máximo de 400 días.",
  kind: "read",
  scope: "read",
  permission: "pay_periods:read",
  input: z.object({
    from: isoDate("Primer día, incluido (aaaa-mm-dd)."),
    to: isoDate("Último día, incluido (aaaa-mm-dd)."),
    group_by: z
      .enum(["person", "site", "month"])
      .default("site")
      .describe(
        "person: una fila por persona. site: por sucursal actual de la persona. month: por mes (aaaa-mm).",
      ),
    site_id: uuid("Sólo personas de esta sucursal.").optional(),
    cursor: cursorSchema,
    limit: limitSchema,
  }),
  output: z.object({
    from: z.string(),
    from_mx: z.string().nullable(),
    to: z.string(),
    to_mx: z.string().nullable(),
    group_by: z.enum(["person", "site", "month"]),
    items: z.array(
      z.object({
        key: z
          .string()
          .nullable()
          .describe(
            "Id de persona, id de sucursal (null: sin sucursal) o aaaa-mm.",
          ),
        label: z.string(),
        present_days: z.number().int(),
        absent_days: z.number().int(),
        justified_absent_days: z.number().int(),
        absenteeism_rate: z
          .number()
          .nullable()
          .describe(
            "Entre 0 y 1; null si no hay días con asistencia ni faltas.",
          ),
        incidencias: z.array(kindTotalsSchema),
        url: z.string().nullable(),
      }),
    ),
    next_cursor: nextCursorSchema,
  }),
  annotations: readAnnotations("Incidencias y ausentismo"),
  handler: async ({ cursor, limit, ...filters }, ctx) => {
    const hash = filtersHash("get_incidencias_summary", filters);
    const range = { from: filters.from, to: filters.to };
    const options = { by: filters.group_by, siteId: filters.site_id };
    const [absenteeism, incidencias] = await Promise.all([
      absenteeismBy(ctx.companyId, range, options),
      incidenciasBy(ctx.companyId, range, options),
    ]).catch(validation);

    const groups = new Map<
      string,
      {
        key: string | null;
        absent: (typeof absenteeism)[number] | null;
        kinds: Record<
          string,
          { count: number; justified: number; minutes: number }
        >;
      }
    >();
    const groupOf = (key: string | null) => {
      const id = key ?? "";
      const group = groups.get(id) ?? { key, absent: null, kinds: {} };
      groups.set(id, group);
      return group;
    };

    for (const row of absenteeism) groupOf(row.key).absent = row;
    for (const row of incidencias) {
      groupOf(row.key).kinds[row.kind] = {
        count: row.count,
        justified: row.justified,
        minutes: row.minutes,
      };
    }

    const ids = [...groups.values()].flatMap((group) =>
      group.key ? [group.key] : [],
    );
    const labels = new Map<string, string>();

    if (filters.group_by === "person" && ids.length > 0) {
      const rows = await tdb(ctx.companyId)
        .select({
          id: people.id,
          nombres: people.nombres,
          apellidoPaterno: people.apellidoPaterno,
          apellidoMaterno: people.apellidoMaterno,
        })
        .from(people)
        .where(withTenant(people, ctx.companyId, inArray(people.id, ids)));
      for (const row of rows) labels.set(row.id, formatPersonName(row));
    }

    if (filters.group_by === "site" && ids.length > 0) {
      const rows = await tdb(ctx.companyId)
        .select({ id: sites.id, name: sites.name })
        .from(sites)
        .where(withTenant(sites, ctx.companyId, inArray(sites.id, ids)));
      for (const row of rows) labels.set(row.id, row.name);
    }

    const rows = [...groups.entries()]
      .map(([id, group]) => ({
        id,
        label:
          group.key === null
            ? "Sin sucursal"
            : (labels.get(group.key) ?? group.key),
        group,
      }))
      // Plain code-unit order: the cursor continues with the same comparison.
      .sort((a, b) =>
        a.label === b.label
          ? a.id < b.id
            ? -1
            : 1
          : a.label < b.label
            ? -1
            : 1,
      );
    const after = decodeCursor(cursor, hash);
    const page = pageOf(
      rows.filter((row) => KEY_AFTER(after, row)).slice(0, limit + 1),
      limit,
      hash,
      (row) => row.label,
    );

    return {
      from: filters.from,
      from_mx: mx(filters.from),
      to: filters.to,
      to_mx: mx(filters.to),
      group_by: filters.group_by,
      items: page.items.map(({ label, group }) => ({
        key: group.key,
        label,
        present_days: group.absent?.presentDays ?? 0,
        absent_days: group.absent?.absentDays ?? 0,
        justified_absent_days: group.absent?.justifiedAbsentDays ?? 0,
        absenteeism_rate: group.absent?.rate ?? null,
        incidencias: kindsOf(group.kinds),
        url:
          filters.group_by === "person" && group.key
            ? appUrl(ctx, `/app/personas/${group.key}`)
            : null,
      })),
      next_cursor: page.next_cursor,
    };
  },
});

export const getPayPeriodTool = defineTool({
  name: "get_pay_period",
  title: "Quincena",
  description:
    "Una quincena (aaaa-mm-Q1: días 1 a 15; aaaa-mm-Q2: del 16 al fin de mes): si está abierta o cerrada, su revisión y sus incidencias por persona. Si está cerrada son las incidencias congeladas en el cierre, las que lee la pre-nómina, y snapshot_matches dice si aún coinciden con las registradas. Si está abierta son las registradas hasta ahora, lo que congelaría un cierre. Sólo lectura: cerrar y reabrir se hace en Workia.",
  kind: "read",
  scope: "read",
  permission: "pay_periods:read",
  input: z.object({
    period: z
      .string()
      .regex(/^\d{4}-(0[1-9]|1[0-2])-Q[12]$/, "Usa aaaa-mm-Q1 o aaaa-mm-Q2.")
      .describe("La quincena, p. ej. 2026-11-Q1."),
    cursor: cursorSchema,
    limit: limitSchema,
  }),
  output: z.object({
    period: z.string(),
    label: z.string(),
    starts_on: z.string(),
    ends_on: z.string(),
    status: z.enum(["open", "closed"]),
    revision: z.number().int().describe("Cuántas veces se ha cerrado."),
    closed_at: z.string().nullable(),
    source: z
      .enum(["snapshot", "live"])
      .describe("snapshot: congelado en el cierre. live: calculado ahora."),
    snapshot_matches: z
      .boolean()
      .nullable()
      .describe(
        "Cerrada: si lo congelado coincide con lo registrado. Abierta: null.",
      ),
    differences: z
      .number()
      .int()
      .nullable()
      .describe("Filas (persona y tipo) que cambiaron después del cierre."),
    totals: z.array(kindTotalsSchema),
    person_count: z.number().int(),
    people: z.array(
      z.object({
        person: z.object({ id: z.string(), nombre_completo: z.string() }),
        incidencias: z.array(kindTotalsSchema),
        url: z.string(),
      }),
    ),
    url: z.string(),
    next_cursor: nextCursorSchema,
  }),
  annotations: readAnnotations("Quincena"),
  handler: async ({ period, cursor, limit }, ctx) => {
    const hash = filtersHash("get_pay_period", { period });
    const [detail, check] = await Promise.all([
      loadPayPeriodIncidencias(ctx.companyId, period),
      verifyPeriodSnapshot(ctx.companyId, period),
    ]);
    const rows = detail.sorted.map((item) => ({
      id: item.row.personId,
      key: item.sortKey.slice(0, 2).join("\u0000"),
      row: item.row,
    }));
    const after = decodeCursor(cursor, hash);
    const page = pageOf(
      rows
        .filter(
          (row) =>
            !after ||
            row.key > after.key ||
            (row.key === after.key && row.id > after.id),
        )
        .slice(0, limit + 1),
      limit,
      hash,
      (row) => row.key,
    );

    return {
      period: detail.period,
      label: detail.label,
      starts_on: detail.startsOn,
      ends_on: detail.endsOn,
      status: detail.status,
      revision: detail.revision,
      closed_at: detail.closedAt ? detail.closedAt.toISOString() : null,
      source: detail.source,
      snapshot_matches: check ? check.matches : null,
      differences: check ? check.differences.length : null,
      totals: kindsOf(detail.totals),
      person_count: detail.personCount,
      people: page.items.map(({ row }) => ({
        person: { id: row.personId, nombre_completo: row.name },
        incidencias: kindsOf(row.kinds),
        url: appUrl(ctx, `/app/personas/${row.personId}`),
      })),
      url: appUrl(ctx, `/app/periodos/${detail.period}`),
      next_cursor: page.next_cursor,
    };
  },
});
