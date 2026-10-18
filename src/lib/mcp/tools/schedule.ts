import { z } from "zod";

import {
  formatScheduleBlocks,
  readStoredBlocks,
  scheduleBlocksSchema,
  WEEK_DAYS,
  type ScheduleBlocks,
} from "@/lib/people/schedule-blocks";
import {
  scheduleBlocksOf,
  type PersonScheduleValues,
} from "@/lib/people/schema";

import { McpToolError } from "../errors";

/** Schedule by blocks over the connector (WRK-I1-11), in the spec's shape. */
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Usa HH:mm.");

export const bloquesInput = z
  .array(
    z.object({
      dias: z.array(z.enum(WEEK_DAYS)).min(1),
      entrada: hhmm,
      salida: hhmm,
      comida: z
        .object({ inicio: hhmm, fin: hhmm })
        .optional()
        .describe("Comida dentro del horario; omítela si no hay."),
    }),
  )
  .max(7)
  .describe(
    "Bloques de días con su horario. Un día no puede estar en dos bloques ni ser el de descanso. Lista vacía borra el horario.",
  );

export const diaDescansoInput = z
  .enum(WEEK_DAYS)
  .nullable()
  .optional()
  .describe("Día de descanso (lun…dom).");

/** The connector's input as the app's schedule value, validated with the app's rules. */
export const toScheduleBlocks = (
  bloques: z.infer<typeof bloquesInput>,
  diaDescanso: z.infer<typeof diaDescansoInput>,
): ScheduleBlocks => {
  const parsed = scheduleBlocksSchema.safeParse({
    bloques: bloques.map((block) => ({
      dias: block.dias,
      entrada: block.entrada,
      salida: block.salida,
      comidaInicio: block.comida?.inicio ?? null,
      comidaFin: block.comida?.fin ?? null,
    })),
    diaDescanso: diaDescanso ?? null,
  });

  if (!parsed.success) {
    throw new McpToolError(
      "VALIDATION",
      parsed.error.issues[0]?.message ?? "Revisa los bloques del horario.",
      {
        details: {
          issues: parsed.error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
      },
    );
  }

  return parsed.data;
};

export const horarioBloquesSchema = z
  .object({
    bloques: z.array(
      z.object({
        dias: z.array(z.string()),
        entrada: z.string(),
        salida: z.string(),
        comida: z.object({ inicio: z.string(), fin: z.string() }).nullable(),
      }),
    ),
    dia_descanso: z.string().nullable(),
    texto: z.string(),
    origen: z
      .enum(["bloques", "simple"])
      .describe("simple: horario anterior leído como un bloque L–V."),
  })
  .nullable();

const toOutput = (
  blocks: ScheduleBlocks | null,
  origen: "bloques" | "simple",
) =>
  blocks
    ? {
        bloques: blocks.bloques.map((block) => ({
          dias: block.dias,
          entrada: block.entrada,
          salida: block.salida,
          comida:
            block.comidaInicio && block.comidaFin
              ? { inicio: block.comidaInicio, fin: block.comidaFin }
              : null,
        })),
        dia_descanso: blocks.diaDescanso,
        texto: formatScheduleBlocks(blocks),
        origen,
      }
    : null;

/** A person's schedule as blocks (a simple one reads as Monday–Friday). */
export const horarioBloques = (schedule?: PersonScheduleValues | null) => {
  const own = readStoredBlocks(schedule?.blocks, schedule?.restDay);

  return own && own.bloques.length > 0
    ? toOutput(own, "bloques")
    : toOutput(scheduleBlocksOf(schedule), "simple");
};

/** A contract's frozen schedule as blocks. */
export const contractHorarioBloques = (contract: {
  scheduleEntrada: string | null;
  scheduleSalidaComer: string | null;
  scheduleRegresoComer: string | null;
  scheduleSalida: string | null;
  scheduleBlocks: unknown;
  scheduleRestDay: string | null;
}) =>
  horarioBloques({
    entrada: contract.scheduleEntrada,
    salidaComer: contract.scheduleSalidaComer,
    regresoComer: contract.scheduleRegresoComer,
    salida: contract.scheduleSalida,
    blocks: contract.scheduleBlocks,
    restDay: contract.scheduleRestDay as PersonScheduleValues["restDay"],
  });
