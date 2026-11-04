import { describe, expect, it } from "vitest";

import { DOCUMENT_REJECTION_REASONS } from "@/lib/db/schema/document-review";

import {
  documentRejectionReasonLabels,
  reviewDocumentSchema,
  sniffDocumentFileType,
} from "./files-schema";
import { buildPersonDocumentCard } from "./person-card";

const bytes = (...values: number[]) => new Uint8Array([...values, 0, 0, 0, 0]);

describe("sniffDocumentFileType", () => {
  it("reads PDF, JPEG, PNG and WebP from the first bytes", () => {
    expect(sniffDocumentFileType(bytes(0x25, 0x50, 0x44, 0x46, 0x2d))).toBe(
      "application/pdf",
    );
    expect(sniffDocumentFileType(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe(
      "image/jpeg",
    );
    expect(
      sniffDocumentFileType(
        bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
      ),
    ).toBe("image/png");
    expect(
      sniffDocumentFileType(
        bytes(0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50),
      ),
    ).toBe("image/webp");
  });

  it("rejects anything else, whatever its name says", () => {
    expect(sniffDocumentFileType(new TextEncoder().encode("<html>"))).toBe(
      null,
    );
    expect(sniffDocumentFileType(bytes(0x4d, 0x5a))).toBe(null);
    expect(sniffDocumentFileType(new Uint8Array())).toBe(null);
  });
});

describe("reviewDocumentSchema", () => {
  const documentId = "00000000-0000-4000-8000-000000000001";

  it("takes an accept with or without an expiry", () => {
    expect(
      reviewDocumentSchema.safeParse({ decision: "accept", documentId })
        .success,
    ).toBe(true);
    expect(
      reviewDocumentSchema.safeParse({
        decision: "accept",
        documentId,
        expiresOn: null,
      }).success,
    ).toBe(true);
    expect(
      reviewDocumentSchema.safeParse({
        decision: "accept",
        documentId,
        expiresOn: "2026-02-30",
      }).success,
    ).toBe(false);
  });

  it("needs a reason from the list to reject, and no free text", () => {
    expect(
      reviewDocumentSchema.safeParse({
        decision: "reject",
        documentId,
        reason: "illegible",
      }).success,
    ).toBe(true);
    expect(
      reviewDocumentSchema.safeParse({ decision: "reject", documentId })
        .success,
    ).toBe(false);
    expect(
      reviewDocumentSchema.safeParse({
        decision: "reject",
        documentId,
        reason: "Su análisis dice…",
      }).success,
    ).toBe(false);
    expect(
      reviewDocumentSchema.safeParse({
        decision: "reject",
        documentId,
        reason: "illegible",
        note: "texto",
      }).success,
    ).toBe(false);
  });

  it("labels every reason", () => {
    for (const reason of DOCUMENT_REJECTION_REASONS) {
      expect(documentRejectionReasonLabels[reason]).toBeTruthy();
    }
  });
});

describe("buildPersonDocumentCard with uploads", () => {
  const personId = "00000000-0000-4000-8000-000000000010";
  const requirement = {
    id: "00000000-0000-4000-8000-000000000020",
    name: "INE",
    required: true,
    validityMonths: null,
    sort: 0,
  };
  const today = "2026-11-04";

  it("does not count a pending upload as a delivery", () => {
    const view = buildPersonDocumentCard(
      [requirement],
      [
        {
          id: "d1",
          personId,
          requirementId: requirement.id,
          deliveredOn: "2026-11-04",
          expiresOn: null,
          status: "uploaded",
          fileKey: "k",
          createdAt: "2026-11-04T10:00:00Z",
        },
      ],
      today,
    );

    expect(view.state).toBe("missing");
    expect(view.rows[0]).toMatchObject({
      status: "missing",
      deliveredOn: null,
      review: { id: "d1", status: "uploaded", rejectionReason: null },
    });
  });

  it("keeps the accepted delivery and shows a newer rejection", () => {
    const view = buildPersonDocumentCard(
      [requirement],
      [
        {
          id: "d1",
          personId,
          requirementId: requirement.id,
          deliveredOn: "2026-01-10",
          expiresOn: null,
          status: "accepted",
          fileKey: "k1",
          createdAt: "2026-01-10T10:00:00Z",
        },
        {
          id: "d2",
          personId,
          requirementId: requirement.id,
          deliveredOn: "2026-11-01",
          expiresOn: null,
          status: "rejected",
          rejectionReason: "illegible",
          createdAt: "2026-11-01T10:00:00Z",
        },
      ],
      today,
    );

    expect(view.rows[0]).toMatchObject({
      status: "valid",
      deliveredOn: "2026-01-10",
      fileDocumentId: "d1",
      review: { id: "d2", status: "rejected", rejectionReason: "illegible" },
    });
  });

  it("drops the review once an accepted row is newer", () => {
    const view = buildPersonDocumentCard(
      [requirement],
      [
        {
          id: "d2",
          personId,
          requirementId: requirement.id,
          deliveredOn: "2026-11-01",
          expiresOn: null,
          status: "rejected",
          rejectionReason: "illegible",
          createdAt: "2026-11-01T10:00:00Z",
        },
        {
          id: "d3",
          personId,
          requirementId: requirement.id,
          deliveredOn: "2026-11-02",
          expiresOn: null,
          status: "accepted",
          createdAt: "2026-11-02T10:00:00Z",
        },
      ],
      today,
    );

    expect(view.rows[0]?.review).toBeUndefined();
    expect(view.rows[0]?.fileDocumentId).toBeUndefined();
    expect(view.state).toBe("ok");
  });
});
