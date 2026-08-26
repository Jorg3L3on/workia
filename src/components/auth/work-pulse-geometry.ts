/** Geometry helpers for the login work-week pulse visualization. */

export const dayToWeekPulseX = (dayIndex: number, totalDays = 7): number =>
  4 + ((dayIndex - 1) / Math.max(totalDays - 1, 1)) * 292;

export const formatWeekdayLabel = (date: Date): string => {
  const weekday = date.toLocaleDateString("en-US", { weekday: "short" });
  const day = date.getDate();
  const month = date.toLocaleDateString("en-US", { month: "short" });
  return `${weekday} ${day} ${month}`;
};

export const getWeekdayIndex = (date: Date): number => {
  const day = date.getDay();
  return day === 0 ? 7 : day;
};
