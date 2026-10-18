import { z } from "zod";

/**
 * Schedule by blocks (WRK-I5-3): each block covers some weekdays with its
 * entry, exit and an optional meal break, plus one rest day. Pure, so the
 * form, the domain, contracts and the connector share it.
 */
export const WEEK_DAYS = [
  "lun",
  "mar",
  "mie",
  "jue",
  "vie",
  "sab",
  "dom",
] as const;

export type WeekDay = (typeof WEEK_DAYS)[number];

export const weekDayLabels: Record<WeekDay, string> = {
  lun: "Lunes",
  mar: "Martes",
  mie: "Miércoles",
  jue: "Jueves",
  vie: "Viernes",
  sab: "Sábado",
  dom: "Domingo",
};

const SHORT: Record<WeekDay, string> = {
  lun: "Lun",
  mar: "Mar",
  mie: "Mié",
  jue: "Jue",
  vie: "Vie",
  sab: "Sáb",
  dom: "Dom",
};

// Ends of a range: «L–V», «L–Sáb».
const RANGE: Record<WeekDay, string> = {
  lun: "L",
  mar: "Ma",
  mie: "Mi",
  jue: "J",
  vie: "V",
  sab: "Sáb",
  dom: "Dom",
};

const time = z
  .string()
  .trim()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Usa horas en formato HH:MM.");

const optionalTime = z
  .union([time, z.literal(""), z.null()])
  .optional()
  .transform((value) => value || null);

export const scheduleBlockSchema = z
  .object({
    dias: z
      .array(z.enum(WEEK_DAYS))
      .min(1, "Cada bloque necesita al menos un día."),
    entrada: time,
    salida: time,
    comidaInicio: optionalTime,
    comidaFin: optionalTime,
  })
  .superRefine((block, ctx) => {
    if (block.entrada >= block.salida) {
      ctx.addIssue({
        code: "custom",
        message: "La salida debe ser después de la entrada.",
        path: ["salida"],
      });
    }

    if (Boolean(block.comidaInicio) !== Boolean(block.comidaFin)) {
      ctx.addIssue({
        code: "custom",
        message: "Indica el inicio y el fin de la comida.",
        path: ["comidaFin"],
      });
      return;
    }

    if (
      block.comidaInicio &&
      block.comidaFin &&
      !(
        block.entrada <= block.comidaInicio &&
        block.comidaInicio < block.comidaFin &&
        block.comidaFin <= block.salida
      )
    ) {
      ctx.addIssue({
        code: "custom",
        message: "La comida debe quedar dentro del horario y en orden.",
        path: ["comidaInicio"],
      });
    }
  });

export type ScheduleBlock = z.infer<typeof scheduleBlockSchema>;

export const scheduleBlocksSchema = z
  .object({
    bloques: z.array(scheduleBlockSchema).max(7),
    diaDescanso: z
      .union([z.enum(WEEK_DAYS), z.literal(""), z.null()])
      .optional()
      .transform((value) => value || null),
  })
  .superRefine((value, ctx) => {
    const seen = new Set<WeekDay>();

    value.bloques.forEach((block, index) => {
      for (const day of block.dias) {
        if (seen.has(day)) {
          ctx.addIssue({
            code: "custom",
            message: `El ${weekDayLabels[day].toLowerCase()} está en dos bloques.`,
            path: ["bloques", index, "dias"],
          });
        }
        seen.add(day);
      }
    });

    if (value.diaDescanso && seen.has(value.diaDescanso)) {
      ctx.addIssue({
        code: "custom",
        message: `El día de descanso (${weekDayLabels[value.diaDescanso].toLowerCase()}) no puede estar en un bloque.`,
        path: ["diaDescanso"],
      });
    }
  });

export type ScheduleBlocks = z.infer<typeof scheduleBlocksSchema>;

const sortDays = (days: readonly WeekDay[]) =>
  [...new Set(days)].sort(
    (a, b) => WEEK_DAYS.indexOf(a) - WEEK_DAYS.indexOf(b),
  );

/** «L–V», «Sáb», «Lun, Mié, Vie». */
export const formatDays = (days: readonly WeekDay[]) => {
  const sorted = sortDays(days);
  const runs: WeekDay[][] = [];

  for (const day of sorted) {
    const last = runs.at(-1);
    if (
      last &&
      WEEK_DAYS.indexOf(day) === WEEK_DAYS.indexOf(last.at(-1)!) + 1
    ) {
      last.push(day);
    } else {
      runs.push([day]);
    }
  }

  return runs
    .flatMap((run) =>
      run.length >= 3
        ? [`${RANGE[run[0]]}–${RANGE[run.at(-1)!]}`]
        : run.map((day) => SHORT[day]),
    )
    .join(", ");
};

/** «L–V 08:00–17:00 (comida 13:00–14:00) · Sáb 08:00–13:00 · Descanso dom». */
export const formatScheduleBlocks = (
  schedule: { bloques: ScheduleBlock[]; diaDescanso?: WeekDay | null } | null,
) => {
  if (!schedule || schedule.bloques.length === 0) {
    return schedule?.diaDescanso
      ? `Descanso ${SHORT[schedule.diaDescanso].toLowerCase()}`
      : "—";
  }

  const parts = [...schedule.bloques]
    .sort(
      (a, b) =>
        WEEK_DAYS.indexOf(sortDays(a.dias)[0]) -
        WEEK_DAYS.indexOf(sortDays(b.dias)[0]),
    )
    .map(
      (block) =>
        `${formatDays(block.dias)} ${block.entrada}–${block.salida}${
          block.comidaInicio && block.comidaFin
            ? ` (comida ${block.comidaInicio}–${block.comidaFin})`
            : ""
        }`,
    );

  if (schedule.diaDescanso) {
    parts.push(`Descanso ${SHORT[schedule.diaDescanso].toLowerCase()}`);
  }

  return parts.join(" · ");
};

/**
 * A legacy simple schedule as one Monday–Friday block (how it is shown when
 * edited), or none when it has no entry and exit.
 */
export const blocksFromLegacy = (
  schedule?: {
    entrada?: string | null;
    salidaComer?: string | null;
    regresoComer?: string | null;
    salida?: string | null;
  } | null,
): ScheduleBlocks | null => {
  const entrada = schedule?.entrada?.slice(0, 5);
  const salida = schedule?.salida?.slice(0, 5);

  if (!entrada || !salida) return null;

  return {
    bloques: [
      {
        dias: ["lun", "mar", "mie", "jue", "vie"],
        entrada,
        salida,
        comidaInicio: schedule?.salidaComer?.slice(0, 5) || null,
        comidaFin: schedule?.regresoComer?.slice(0, 5) || null,
      },
    ],
    diaDescanso: null,
  };
};

/** The legacy four fields, mirrored from the first block (imports, exports and filters still read them). */
export const legacyFromBlocks = (schedule: ScheduleBlocks) => {
  const [first] = schedule.bloques;

  return {
    entrada: first?.entrada ?? null,
    salidaComer: first?.comidaInicio ?? null,
    regresoComer: first?.comidaFin ?? null,
    salida: first?.salida ?? null,
  };
};

/** Reads the stored jsonb back, tolerating rows written before the blocks existed. */
export const readStoredBlocks = (
  blocks: unknown,
  restDay: string | null | undefined,
): ScheduleBlocks | null => {
  if (!Array.isArray(blocks)) return null;

  const parsed = scheduleBlocksSchema.safeParse({
    bloques: blocks,
    diaDescanso: restDay ?? null,
  });

  return parsed.success ? parsed.data : null;
};
