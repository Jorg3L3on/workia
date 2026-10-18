import { describe, expect, it } from "vitest";

import {
  blocksFromLegacy,
  formatDays,
  formatScheduleBlocks,
  legacyFromBlocks,
  readStoredBlocks,
  scheduleBlocksSchema,
} from "@/lib/people/schedule-blocks";

const weekdays = {
  dias: ["lun", "mar", "mie", "jue", "vie"],
  entrada: "08:00",
  salida: "17:00",
  comidaInicio: "13:00",
  comidaFin: "14:00",
};
const saturday = { dias: ["sab"], entrada: "08:00", salida: "13:00" };

const messages = (value: unknown) => {
  const parsed = scheduleBlocksSchema.safeParse(value);
  return parsed.success
    ? []
    : parsed.error.issues.map((issue) => issue.message);
};

describe("schedule by blocks", () => {
  it("formats the spec example", () => {
    const parsed = scheduleBlocksSchema.parse({
      bloques: [saturday, weekdays],
      diaDescanso: "dom",
    });
    expect(formatScheduleBlocks(parsed)).toBe(
      "L–V 08:00–17:00 (comida 13:00–14:00) · Sáb 08:00–13:00 · Descanso dom",
    );
  });

  it("formats days as ranges or lists", () => {
    expect(formatDays(["vie", "lun", "mar", "mie", "jue"])).toBe("L–V");
    expect(formatDays(["lun", "mie", "vie"])).toBe("Lun, Mié, Vie");
    expect(formatDays(["sab", "dom"])).toBe("Sáb, Dom");
    expect(formatDays(["lun", "mar", "mie", "jue", "vie", "sab"])).toBe(
      "L–Sáb",
    );
  });

  it("refuses a day in two blocks or the rest day in a block", () => {
    expect(
      messages({ bloques: [weekdays, { ...saturday, dias: ["vie"] }] }),
    ).toEqual(["El viernes está en dos bloques."]);
    expect(messages({ bloques: [saturday], diaDescanso: "sab" })).toEqual([
      "El día de descanso (sábado) no puede estar en un bloque.",
    ]);
  });

  it("refuses hours out of order and half a meal", () => {
    expect(
      messages({ bloques: [{ ...saturday, entrada: "14:00" }] }),
    ).toContain("La salida debe ser después de la entrada.");
    expect(messages({ bloques: [{ ...weekdays, comidaFin: "" }] })).toContain(
      "Indica el inicio y el fin de la comida.",
    );
    expect(
      messages({
        bloques: [{ ...weekdays, comidaInicio: "18:00", comidaFin: "19:00" }],
      }),
    ).toContain("La comida debe quedar dentro del horario y en orden.");
    expect(messages({ bloques: [{ ...saturday, dias: [] }] })).toContain(
      "Cada bloque necesita al menos un día.",
    );
  });

  it("reads a simple schedule as Monday–Friday and mirrors the first block back", () => {
    const blocks = blocksFromLegacy({
      entrada: "09:00:00",
      salidaComer: "14:00",
      regresoComer: "15:00",
      salida: "18:00",
    });
    expect(formatScheduleBlocks(blocks)).toBe(
      "L–V 09:00–18:00 (comida 14:00–15:00)",
    );
    expect(legacyFromBlocks(blocks!)).toEqual({
      entrada: "09:00",
      salidaComer: "14:00",
      regresoComer: "15:00",
      salida: "18:00",
    });
    expect(blocksFromLegacy({ entrada: "09:00" })).toBeNull();
  });

  it("ignores stored values that are not valid blocks", () => {
    expect(readStoredBlocks(null, null)).toBeNull();
    expect(readStoredBlocks([{ dias: "x" }], null)).toBeNull();
    expect(readStoredBlocks([saturday], "dom")?.diaDescanso).toBe("dom");
  });
});
