/** Geometry helpers for the login payroll (nómina) pulse visualization. */

export const daysInCalendarMonth = (year: number, month1to12: number): number =>
  new Date(year, month1to12, 0).getDate();

export const dayToPulseX = (day: number, daysInMonth: number): number =>
  4 + ((day - 1) / Math.max(daysInMonth - 1, 1)) * 292;

export const formatPayrollDateLabel = (date: Date): string => {
  const day = date.getDate();
  const month = date
    .toLocaleDateString("es-MX", { month: "short" })
    .replace(".", "");
  return `${day} ${month}`;
};
