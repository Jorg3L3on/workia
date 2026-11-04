import { addDays } from "@/lib/incidencias/days";

/**
 * The absence thresholds of LFT article 47, section X (W2-19): more than
 * three unjustified faltas in a period of 30 days. Three is the early
 * warning, four is the threshold. A period of 30 days is any 30 consecutive
 * calendar days, both ends included, so each falta is checked with the 29
 * days before it.
 */
export const ABSENCE_WINDOW_DAYS = 30;
export const ABSENCE_WARNING_COUNT = 3;
/** "Más de tres". */
export const ABSENCE_THRESHOLD_COUNT = 4;

export type AbsenceLevel = "absence_warning" | "absence_threshold";

export type AbsenceAlertCandidate = {
  level: AbsenceLevel;
  /** The falta that reached the count. */
  triggerDay: string;
  /** First day of the 30 days counted. */
  windowFrom: string;
  /** The unjustified faltas in those 30 days, oldest first. */
  days: string[];
};

const levelFor = (count: number): AbsenceLevel | null =>
  count >= ABSENCE_THRESHOLD_COUNT
    ? "absence_threshold"
    : count >= ABSENCE_WARNING_COUNT
      ? "absence_warning"
      : null;

/**
 * The absence alerts one person's faltas call for. `faltaDays` are the
 * unjustified, not voided faltas (any order, duplicates ignored); `prior`
 * are the alerts already sent to this person. An alert is due on a falta
 * from `fromDay` on that brings its 30 days to the level, unless an alert of
 * that level was already sent within those 30 days: a run of faltas warns
 * once per level, and a new run after 30 clean days warns again.
 */
export const detectAbsenceAlerts = (
  faltaDays: readonly string[],
  prior: ReadonlyArray<{ level: AbsenceLevel; triggerDay: string }>,
  fromDay: string,
): AbsenceAlertCandidate[] => {
  const days = [...new Set(faltaDays)].sort();
  const sent = prior.map((alert) => ({ ...alert }));
  const alerts: AbsenceAlertCandidate[] = [];

  for (const [index, day] of days.entries()) {
    const windowFrom = addDays(day, -(ABSENCE_WINDOW_DAYS - 1));
    const inWindow = days
      .slice(0, index + 1)
      .filter((other) => other >= windowFrom);
    const level = levelFor(inWindow.length);

    if (!level || day < fromDay) continue;

    const already = sent.some(
      (alert) =>
        alert.level === level &&
        alert.triggerDay >= windowFrom &&
        alert.triggerDay <= day,
    );

    if (already) continue;

    const candidate = { level, triggerDay: day, windowFrom, days: inWindow };

    alerts.push(candidate);
    sent.push({ level, triggerDay: day });
  }

  return alerts;
};
