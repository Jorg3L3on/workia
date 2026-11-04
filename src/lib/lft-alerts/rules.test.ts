import { describe, expect, it } from "vitest";

import { addDays } from "@/lib/incidencias/days";

import { absenceAlertBody, LFT_ABSENCE_RULE } from "./copy";
import {
  ABSENCE_THRESHOLD_COUNT,
  ABSENCE_WARNING_COUNT,
  ABSENCE_WINDOW_DAYS,
  detectAbsenceAlerts,
} from "./rules";

const TODAY = "2026-11-20";
const ago = (days: number) => addDays(TODAY, -days);
const FROM = ago(ABSENCE_WINDOW_DAYS - 1);

describe("LFT article 47-X thresholds", () => {
  it("warns at three and reaches the threshold at more than three, in 30 days", () => {
    expect(ABSENCE_WARNING_COUNT).toBe(3);
    expect(ABSENCE_THRESHOLD_COUNT).toBe(4);
    expect(ABSENCE_WINDOW_DAYS).toBe(30);
  });

  it("two faltas are not an alert", () => {
    expect(detectAbsenceAlerts([ago(3), ago(1)], [], FROM)).toEqual([]);
  });

  it("the third falta in 30 days is the early warning", () => {
    expect(detectAbsenceAlerts([ago(1), ago(20), ago(10)], [], FROM)).toEqual([
      {
        level: "absence_warning",
        triggerDay: ago(1),
        windowFrom: addDays(ago(1), -29),
        days: [ago(20), ago(10), ago(1)],
      },
    ]);
  });

  it("counts 30 calendar days, both ends included", () => {
    // ago(29) to ago(0) is 30 days; ago(30) is outside.
    expect(
      detectAbsenceAlerts([ago(29), ago(15), TODAY], [], FROM),
    ).toHaveLength(1);
    expect(detectAbsenceAlerts([ago(30), ago(15), TODAY], [], FROM)).toEqual(
      [],
    );
  });

  it("the fourth falta is the threshold, and each level is sent once per run", () => {
    const alerts = detectAbsenceAlerts(
      [ago(12), ago(9), ago(6), ago(3), ago(1)],
      [],
      FROM,
    );

    expect(alerts.map((alert) => [alert.level, alert.triggerDay])).toEqual([
      ["absence_warning", ago(6)],
      ["absence_threshold", ago(3)],
    ]);
  });

  it("does not repeat a level already sent within the 30 days", () => {
    expect(
      detectAbsenceAlerts(
        [ago(12), ago(9), ago(6), ago(3)],
        [
          { level: "absence_warning", triggerDay: ago(6) },
          { level: "absence_threshold", triggerDay: ago(3) },
        ],
        FROM,
      ),
    ).toEqual([]);
    expect(
      detectAbsenceAlerts(
        [ago(12), ago(9), ago(6), ago(3)],
        [{ level: "absence_warning", triggerDay: ago(6) }],
        FROM,
      ).map((alert) => alert.level),
    ).toEqual(["absence_threshold"]);
  });

  it("warns again for a new run of faltas after 30 days", () => {
    const old = [ago(70), ago(68), ago(66)];
    const recent = [ago(5), ago(3), ago(1)];

    expect(
      detectAbsenceAlerts(
        [...old, ...recent],
        [{ level: "absence_warning", triggerDay: ago(66) }],
        FROM,
      ).map((alert) => alert.triggerDay),
    ).toEqual([ago(1)]);
  });

  it("does not alert on a trigger before the check's first day", () => {
    expect(detectAbsenceAlerts([ago(40), ago(38), ago(36)], [], FROM)).toEqual(
      [],
    );
  });

  it("ignores repeated days", () => {
    expect(detectAbsenceAlerts([ago(2), ago(2), ago(1)], [], FROM)).toEqual([]);
  });
});

describe("alert copy", () => {
  it("states the legal threshold correctly", () => {
    expect(LFT_ABSENCE_RULE).toContain("artículo 47, fracción X");
    expect(LFT_ABSENCE_RULE).toContain("más de tres faltas");
    expect(LFT_ABSENCE_RULE).toContain("periodo de 30 días");
    expect(LFT_ABSENCE_RULE).toContain(
      "sin permiso del patrón o sin causa justificada",
    );
  });

  it("the warning says one more falta crosses the threshold; the threshold does not decide", () => {
    const data = { count: 3, from: "2026-10-22", to: "2026-11-20" };

    expect(absenceAlertBody("absence_warning", data)).toContain(
      "Con una falta más",
    );
    expect(
      absenceAlertBody("absence_threshold", { ...data, count: 4 }),
    ).toContain("no decide ni redacta una rescisión");
    expect(
      absenceAlertBody("absence_threshold", { ...data, count: 4 }),
    ).toContain("más de tres en 30 días");
  });
});
