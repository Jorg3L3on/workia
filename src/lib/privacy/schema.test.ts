import { describe, expect, it } from "vitest";

import {
  ARCO_RESPONSE_DAYS,
  arcoDaysLeft,
  arcoDueOn,
  createArcoRequestSchema,
  normalizeNoticeBody,
  publishNoticeSchema,
  PRIVACY_COPY,
  PRIVACY_NOTICE_MAX_LENGTH,
  resolveArcoRequestSchema,
} from "./schema";

const PERSON = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

describe("ARCO due date", () => {
  it("adds 20 calendar days, across months and years", () => {
    expect(ARCO_RESPONSE_DAYS).toBe(20);
    expect(arcoDueOn("2026-10-01")).toBe("2026-10-21");
    expect(arcoDueOn("2026-12-20")).toBe("2027-01-09");
    expect(arcoDueOn("2028-02-15")).toBe("2028-03-06");
  });

  it("rejects a date that does not exist", () => {
    expect(() => arcoDueOn("2026-02-30")).toThrow();
  });

  it("counts the days left, negative when late", () => {
    expect(arcoDaysLeft("2026-10-21", "2026-10-01")).toBe(20);
    expect(arcoDaysLeft("2026-10-21", "2026-10-21")).toBe(0);
    expect(arcoDaysLeft("2026-10-21", "2026-10-24")).toBe(-3);
  });
});

describe("privacy notice text", () => {
  it("folds line endings and trims, so a pasted copy is the same text", () => {
    expect(normalizeNoticeBody("  Aviso\r\nLínea 2\r\n ")).toBe(
      "Aviso\nLínea 2",
    );
  });

  it("requires text and caps the length", () => {
    expect(
      publishNoticeSchema.safeParse({ body: "   " }).error?.issues[0]?.message,
    ).toBe(PRIVACY_COPY.noticeBody);
    expect(
      publishNoticeSchema.safeParse({
        body: "x".repeat(PRIVACY_NOTICE_MAX_LENGTH + 1),
      }).success,
    ).toBe(false);
    expect(publishNoticeSchema.parse({ body: " Aviso " })).toEqual({
      body: "Aviso",
    });
  });
});

describe("ARCO request input", () => {
  const valid = {
    personId: PERSON,
    kind: "access",
    channel: "hr",
    detail: "Copia de mis datos",
    receivedOn: "2026-10-01",
  };

  it("accepts the four kinds only", () => {
    for (const kind of [
      "access",
      "rectification",
      "cancellation",
      "opposition",
    ]) {
      expect(
        createArcoRequestSchema.safeParse({ ...valid, kind }).success,
      ).toBe(true);
    }

    expect(
      createArcoRequestSchema.safeParse({ ...valid, kind: "portability" }).error
        ?.issues[0]?.message,
    ).toBe(PRIVACY_COPY.arcoKind);
  });

  it("needs a real received date and a description", () => {
    expect(
      createArcoRequestSchema.safeParse({ ...valid, receivedOn: "2026-13-01" })
        .success,
    ).toBe(false);
    expect(
      createArcoRequestSchema.safeParse({ ...valid, detail: "  " }).error
        ?.issues[0]?.message,
    ).toBe(PRIVACY_COPY.arcoDetail);
  });

  it("closes only as resolved or rejected, with an answer", () => {
    expect(
      resolveArcoRequestSchema.safeParse({
        requestId: PERSON,
        outcome: "received",
        response: "x",
      }).success,
    ).toBe(false);
    expect(
      resolveArcoRequestSchema.safeParse({
        requestId: PERSON,
        outcome: "resolved",
        response: "",
      }).error?.issues[0]?.message,
    ).toBe(PRIVACY_COPY.arcoResponse);
  });
});
