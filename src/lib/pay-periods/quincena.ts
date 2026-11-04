import type { DayRange } from "@/lib/timeline/aggregates";

/** Every company pays quincenal (Workia 2.0 P-02). No database access here. */

const PERIOD = /^(\d{4})-(0[1-9]|1[0-2])-Q([12])$/;
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The longest reopen reason, as on other audit notes. */
export const MAX_REOPEN_REASON = 280;

export class PayPeriodError extends Error {
  constructor(
    readonly code:
      "invalid_period" | "already_closed" | "not_closed" | "reason_required",
    message: string,
  ) {
    super(message);
    this.name = "PayPeriodError";
  }
}

const pad = (value: number) => String(value).padStart(2, "0");

/** The quincena a local day belongs to: 'YYYY-MM-Q1' (1 to 15) or 'YYYY-MM-Q2'. */
export const quincenaOf = (day: string) => {
  const match = DAY.exec(day);

  if (!match) {
    throw new PayPeriodError("invalid_period", `Fecha inválida: ${day}`);
  }

  return `${match[1]}-${match[2]}-Q${Number(match[3]) <= 15 ? 1 : 2}`;
};

/** The local days of a quincena, both ends included. */
export const quincenaRange = (period: string): DayRange => {
  const match = PERIOD.exec(period);

  if (!match) {
    throw new PayPeriodError(
      "invalid_period",
      `Periodo inválido: ${period}. Usa AAAA-MM-Q1 o AAAA-MM-Q2.`,
    );
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const prefix = `${match[1]}-${match[2]}`;

  if (match[3] === "1") {
    return { from: `${prefix}-01`, to: `${prefix}-15` };
  }

  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { from: `${prefix}-16`, to: `${prefix}-${pad(lastDay)}` };
};
