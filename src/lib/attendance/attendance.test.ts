import { describe, expect, it } from "vitest";

import { distanceMeters, qrCodeFor, QR_WINDOW_MS, verifyQrCode } from "./qr";
import {
  CSV_FORMAT_PRESETS,
  csvFormatSchema,
  normalizeBadge,
  parsePunchTime,
  readChecadorCsv,
} from "./csv-format";
import { parseDevicePush } from "./device-push";
import { instantFromWallTime, localDay, localTime } from "./time";

describe("local time", () => {
  it("reads Mexico City wall time as UTC-6 and back", () => {
    const at = instantFromWallTime({
      year: 2026,
      month: 11,
      day: 3,
      hour: 23,
      minute: 30,
      second: 0,
    });

    expect(at?.toISOString()).toBe("2026-11-04T05:30:00.000Z");
    expect(localDay(at!)).toBe("2026-11-03");
    expect(localTime(at!)).toBe("23:30");
  });

  it("refuses impossible dates", () => {
    expect(
      instantFromWallTime({
        year: 2026,
        month: 2,
        day: 30,
        hour: 8,
        minute: 0,
        second: 0,
      }),
    ).toBeNull();
    expect(
      instantFromWallTime({
        year: 2026,
        month: 1,
        day: 1,
        hour: 24,
        minute: 0,
        second: 0,
      }),
    ).toBeNull();
  });
});

describe("punch time", () => {
  it.each([
    ["2026-11-03 08:12", null, "YYYY-MM-DD", "2026-11-03T14:12:00.000Z"],
    ["2026-11-03T08:12:09", null, "YYYY-MM-DD", "2026-11-03T14:12:09.000Z"],
    ["03/11/2026 8:12 p. m.", null, "DD/MM/YYYY", "2026-11-04T02:12:00.000Z"],
    ["11/03/2026 12:05AM", null, "MM/DD/YYYY", "2026-11-03T06:05:00.000Z"],
    ["03-11-2026", "08:12:00", "DD/MM/YYYY", "2026-11-03T14:12:00.000Z"],
    ["2026-11-03T08:12:00Z", null, "DD/MM/YYYY", "2026-11-03T08:12:00.000Z"],
    [
      "2026-11-03T08:12:00-07:00",
      null,
      "YYYY-MM-DD",
      "2026-11-03T15:12:00.000Z",
    ],
  ] as const)("%s %s (%s)", (date, time, format, expected) => {
    expect(parsePunchTime(date, time, format)?.toISOString()).toBe(expected);
  });

  it("returns null when the text does not match the format", () => {
    expect(parsePunchTime("2026-11-03 08:12", null, "DD/MM/YYYY")).toBeNull();
    expect(parsePunchTime("mañana", null, "YYYY-MM-DD")).toBeNull();
    expect(
      parsePunchTime("03/11/2026 13:00 pm", null, "DD/MM/YYYY"),
    ).toBeNull();
  });
});

describe("checador CSV", () => {
  it("reads columns by header name, keeps bad lines with their raw cells", () => {
    const text = [
      "﻿No. ;Nombre;Fecha;Hora;Estado",
      "00123;Ana;03/11/2026;08:01;E",
      "123;Ana;03/11/2026;17:02;S",
      ";Sin número;03/11/2026;09:00;E",
      "45;Luis;31/02/2026;09:00;E",
      "",
    ].join("\n");
    const read = readChecadorCsv(text, {
      delimiter: "auto",
      headerRows: 1,
      badgeColumn: "no.",
      dateColumn: "Fecha",
      timeColumn: "hora",
      dateFormat: "DD/MM/YYYY",
      kindColumn: "Estado",
      inValues: ["e"],
      outValues: ["S"],
    });

    expect(read.rows).toBe(4);
    expect(
      read.punches.map((punch) => [
        punch.line,
        punch.badge,
        punch.kind,
        punch.at.toISOString(),
      ]),
    ).toEqual([
      [2, "123", "in", "2026-11-03T14:01:00.000Z"],
      [3, "123", "out", "2026-11-03T23:02:00.000Z"],
    ]);
    expect(read.invalid.map((row) => [row.line, row.raw[1]])).toEqual([
      [4, "Sin número"],
      [5, "Luis"],
    ]);
  });

  it("reads the tab preset without a header", () => {
    const preset = CSV_FORMAT_PRESETS.find((item) => item.id === "attlog")!;
    const read = readChecadorCsv(
      "  7\t2026-11-03 08:00:00\t1\t0\t0\n  7\t2026-11-03 17:00:00\t1\t1\t0\n",
      preset.format,
    );

    expect(read.punches.map((punch) => [punch.badge, punch.kind])).toEqual([
      ["7", "in"],
      ["7", "out"],
    ]);
  });

  it("marks every line when the file lacks the format's columns", () => {
    const read = readChecadorCsv("Otra,Cosa\n1,2\n", {
      delimiter: ",",
      headerRows: 1,
      badgeColumn: "No.",
      dateTimeColumn: "Fecha",
      dateFormat: "YYYY-MM-DD",
    });

    expect(read.punches).toEqual([]);
    expect(read.invalid).toHaveLength(1);
  });

  it("normalizes numbers so 00123 and 123 are one person", () => {
    expect(normalizeBadge(" 00123 ")).toBe("123");
    expect(normalizeBadge("0")).toBe("0");
    expect(normalizeBadge("A007")).toBe("A007");
  });

  it("validates a format", () => {
    expect(
      csvFormatSchema.safeParse({
        delimiter: "auto",
        headerRows: 0,
        badgeColumn: "No.",
        dateTimeColumn: "2",
        dateFormat: "YYYY-MM-DD",
      }).success,
    ).toBe(false);
    expect(
      csvFormatSchema.safeParse({
        delimiter: "auto",
        headerRows: 1,
        badgeColumn: "1",
        dateFormat: "YYYY-MM-DD",
      }).success,
    ).toBe(false);
    for (const preset of CSV_FORMAT_PRESETS) {
      expect(csvFormatSchema.safeParse(preset.format).success, preset.id).toBe(
        true,
      );
    }
  });
});

describe("device push body", () => {
  it("keeps good punches and reports the rest with their values", () => {
    const parsed = parseDevicePush(
      JSON.stringify({
        punches: [
          { badge: 12, at: "2026-11-03 08:00", kind: "in" },
          { badge: "12", at: "ayer" },
          "nope",
        ],
      }),
    );

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(
      parsed.punches.map((punch) => [
        punch.badge,
        punch.kind,
        punch.at.toISOString(),
      ]),
    ).toEqual([["12", "in", "2026-11-03T14:00:00.000Z"]]);
    expect(parsed.invalid.map((row) => [row.line, row.raw])).toEqual([
      [2, ["badge=12", "at=ayer"]],
      [3, ['"nope"']],
    ]);
  });

  it("refuses a body that is not a list of punches", () => {
    expect(parseDevicePush("{").ok).toBe(false);
    expect(parseDevicePush(JSON.stringify({ punches: [] })).ok).toBe(false);
    expect(
      parseDevicePush(JSON.stringify({ punches: Array(1001).fill({}) })).ok,
    ).toBe(false);
  });
});

describe("QR codes", () => {
  const site = {
    siteId: "6f1c1e2a-0000-4000-8000-000000000001",
    qrSecret: "s".repeat(43),
    qrMode: "rotating" as const,
  };
  const now = new Date("2026-11-03T14:00:10Z");

  it("accept the current code for three minutes, then expire", () => {
    const code = qrCodeFor(site, now);

    expect(verifyQrCode(site, code, now)).toBe("ok");
    expect(
      verifyQrCode(site, code, new Date(now.getTime() + 2 * QR_WINDOW_MS)),
    ).toBe("ok");
    expect(
      verifyQrCode(site, code, new Date(now.getTime() + 3 * QR_WINDOW_MS)),
    ).toBe("expired");
    expect(
      verifyQrCode(site, code, new Date(now.getTime() - QR_WINDOW_MS)),
    ).toBe("expired");
  });

  it("refuse a forged or another site's code", () => {
    const code = qrCodeFor(site, now);

    expect(
      verifyQrCode(
        site,
        { ...code, window: String(Number(code.window) + 100) },
        now,
      ),
    ).toBe("invalid");
    expect(verifyQrCode({ ...site, qrSecret: "x".repeat(43) }, code, now)).toBe(
      "invalid",
    );
    expect(
      verifyQrCode(
        { ...site, siteId: "6f1c1e2a-0000-4000-8000-000000000002" },
        code,
        now,
      ),
    ).toBe("invalid");
  });

  it("printed codes last until the secret changes, and only in printed mode", () => {
    const printed = { ...site, qrMode: "printed" as const };
    const code = qrCodeFor(printed, now);

    expect(code.window).toBe("p");
    expect(verifyQrCode(printed, code, new Date("2030-01-01"))).toBe("ok");
    expect(verifyQrCode(site, code, now)).toBe("expired");
  });
});

describe("distance", () => {
  it("measures meters on the ground", () => {
    const a = { latitude: 19.4326, longitude: -99.1332 };

    expect(Math.round(distanceMeters(a, a))).toBe(0);
    expect(
      Math.round(distanceMeters(a, { latitude: 19.4336, longitude: -99.1332 })),
    ).toBe(111);
  });
});
