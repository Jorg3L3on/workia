import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { personDocuments } from "@/lib/db/schema/documents";
import {
  ONBOARDING_CHECKLIST,
  onboardingChecklistLabels,
} from "@/lib/onboarding/schema";

import {
  addCalendarMonths,
  DEFAULT_DOCUMENT_REQUIREMENTS,
  expiresOnFromForm,
  latestDelivery,
  recordDeliverySchema,
  setRequirementsSchema,
  statusOf,
  type RequirementStatusInput,
} from "./schema";

const requirement: RequirementStatusInput = { required: true };
const today = "2026-10-28";

describe("statusOf", () => {
  it("is missing when there is no delivery", () => {
    expect(statusOf(requirement, null, today)).toBe("missing");
  });

  it("is valid when the delivery has no expiry", () => {
    expect(statusOf(requirement, { expiresOn: null }, today)).toBe("valid");
  });

  it("is expiring exactly 30 days out", () => {
    expect(statusOf(requirement, { expiresOn: "2026-11-27" }, today)).toBe(
      "expiring",
    );
  });

  it("is valid exactly 31 days out", () => {
    expect(statusOf(requirement, { expiresOn: "2026-11-28" }, today)).toBe(
      "valid",
    );
  });

  it("is expired the day after expires_on", () => {
    expect(
      statusOf(requirement, { expiresOn: "2026-10-28" }, "2026-10-29"),
    ).toBe("expired");
  });

  it("is still expiring on the expiry day", () => {
    expect(statusOf(requirement, { expiresOn: today }, today)).toBe("expiring");
  });

  it("reads the calendar date from the start of an ISO timestamp", () => {
    expect(
      statusOf(
        requirement,
        { expiresOn: "2026-11-27" },
        "2026-10-28T23:30:00-06:00",
      ),
    ).toBe("expiring");
  });
});

describe("default document requirements", () => {
  it("copies the alta checklist names and leaves two papers optional", () => {
    expect(DEFAULT_DOCUMENT_REQUIREMENTS.map((item) => item.name)).toEqual(
      ONBOARDING_CHECKLIST.map((item) => onboardingChecklistLabels[item]),
    );

    const requiredByName = new Map(
      DEFAULT_DOCUMENT_REQUIREMENTS.map((item) => [item.name, item.required]),
    );

    expect(
      requiredByName.get(onboardingChecklistLabels.constancia_fiscal),
    ).toBe(false);
    expect(requiredByName.get(onboardingChecklistLabels.cuenta_bancaria)).toBe(
      false,
    );
    expect(requiredByName.get(onboardingChecklistLabels.ine)).toBe(true);
    expect(requiredByName.get(onboardingChecklistLabels.contrato_firmado)).toBe(
      true,
    );
  });
});

describe("document schemas", () => {
  it("rejects a delivery note, result or observation", () => {
    const parsed = recordDeliverySchema.safeParse({
      personId: "00000000-0000-4000-8000-000000000001",
      requirementId: "00000000-0000-4000-8000-000000000002",
      deliveredOn: "2026-01-15",
      note: "observación",
      resultado: "apto",
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects an expiry before the delivery date", () => {
    const parsed = recordDeliverySchema.safeParse({
      personId: "00000000-0000-4000-8000-000000000001",
      requirementId: "00000000-0000-4000-8000-000000000002",
      deliveredOn: "2026-02-01",
      expiresOn: "2026-01-01",
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects duplicate requirement names", () => {
    const parsed = setRequirementsSchema.safeParse({
      positionId: null,
      requirements: [
        {
          name: "Identificación",
          required: true,
          validityMonths: null,
          sort: 0,
          active: true,
        },
        {
          name: "identificación",
          required: true,
          validityMonths: null,
          sort: 1,
          active: true,
        },
      ],
    });

    expect(parsed.success).toBe(false);
  });
});

describe("person_documents columns", () => {
  it("stores the delivery date and nothing that could hold a result or a note", () => {
    const names = getTableConfig(personDocuments).columns.map(
      (column) => column.name,
    );

    expect(names).toEqual([
      "id",
      "company_id",
      "person_id",
      "requirement_id",
      "delivered_on",
      "expires_on",
      "created_by",
      "created_at",
      "updated_at",
    ]);
  });
});

describe("addCalendarMonths", () => {
  it("clamps the day to the end of the target month", () => {
    expect(addCalendarMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addCalendarMonths("2024-01-31", 1)).toBe("2024-02-29");
  });
});

const person = "00000000-0000-4000-8000-000000000010";
const otherPerson = "00000000-0000-4000-8000-000000000011";
const requirementId = "00000000-0000-4000-8000-000000000020";
const otherRequirement = "00000000-0000-4000-8000-000000000021";

describe("latestDelivery", () => {
  it("keeps the latest delivered_on per person and requirement", () => {
    const older = {
      personId: person,
      requirementId,
      deliveredOn: "2026-01-01",
      expiresOn: "2026-02-01",
    };
    const newer = {
      personId: person,
      requirementId,
      deliveredOn: "2026-06-01",
      expiresOn: "2027-06-01",
    };
    const other = {
      personId: otherPerson,
      requirementId,
      deliveredOn: "2026-03-01",
      expiresOn: null,
    };
    const otherPaper = {
      personId: person,
      requirementId: otherRequirement,
      deliveredOn: "2025-01-01",
      expiresOn: "2025-02-01",
    };

    expect(latestDelivery([older, other, newer, otherPaper])).toEqual([
      newer,
      other,
      otherPaper,
    ]);
    expect(
      statusOf(requirement, latestDelivery([older, newer])[0], today),
    ).toBe("valid");
  });

  it("breaks a same-day tie by createdAt, then by list order", () => {
    const first = {
      personId: person,
      requirementId,
      deliveredOn: "2026-06-01",
      createdAt: "2026-06-01T10:00:00.000Z",
    };
    const second = {
      personId: person,
      requirementId,
      deliveredOn: "2026-06-01",
      createdAt: "2026-06-01T12:00:00.000Z",
    };
    const tiedEarly = {
      personId: person,
      requirementId: otherRequirement,
      deliveredOn: "2026-06-01",
      createdAt: "2026-06-01T10:00:00.000Z",
    };
    const tiedLate = {
      personId: person,
      requirementId: otherRequirement,
      deliveredOn: "2026-06-01",
      createdAt: "2026-06-01T10:00:00.000Z",
    };

    expect(latestDelivery([first, second])).toEqual([second]);
    expect(latestDelivery([second, first])).toEqual([second]);
    expect(latestDelivery([tiedEarly, tiedLate])).toEqual([tiedLate]);
  });
});

describe("expiresOnFromForm", () => {
  it("treats a missing or blank expiry as not sent", () => {
    expect(expiresOnFromForm(null, null)).toBeUndefined();
    expect(expiresOnFromForm("", null)).toBeUndefined();
    expect(expiresOnFromForm("  ", null)).toBeUndefined();
  });

  it("keeps a posted date", () => {
    expect(expiresOnFromForm("2026-12-31", null)).toBe("2026-12-31");
  });

  it("stores null when noVence is checked, even if a date was posted", () => {
    expect(expiresOnFromForm("2026-12-31", "on")).toBeNull();
    expect(expiresOnFromForm("", "true")).toBeNull();
    expect(expiresOnFromForm(null, "1")).toBeNull();
    expect(expiresOnFromForm(null, "false")).toBeUndefined();
  });
});
