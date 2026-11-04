import { describe, expect, it } from "vitest";

import { NOTIFICATION_TEMPLATES } from "@/lib/db/schema/notifications";

import {
  notificationEmail,
  renderNotification,
  type TemplateData,
} from "./templates";

const SAMPLES: { [T in keyof TemplateData]: TemplateData[T] } = {
  receipt_available: { period: "1.ª quincena de noviembre de 2026" },
  request_decision: {
    request: "vacaciones",
    decision: "rechazada",
    from: "2026-12-21",
    to: "2026-12-24",
    reason: "Cierre de inventario.",
  },
  document_rejected: { document: "INE", reason: "La foto no se lee." },
  contract_ending: {
    personId: "00000000-0000-4000-8000-000000000001",
    personName: "Ana López",
    endDate: "2026-11-30",
  },
  request_pending: {
    requesterName: "Luis Pérez",
    request: "permiso",
    from: "2026-11-10",
    to: "2026-11-10",
  },
};

describe("notification templates", () => {
  it.each(NOTIFICATION_TEMPLATES)(
    "%s renders a title, a body and an app path",
    (template) => {
      const content = renderNotification(
        template,
        SAMPLES[template] as never,
        "person",
      );

      expect(content.title.length).toBeGreaterThan(5);
      expect(content.body.length).toBeGreaterThan(5);
      expect(content.url).toMatch(/^\/(?!\/)/);
    },
  );

  it("formats dates the Mexican way and says one day as one day", () => {
    expect(
      renderNotification("request_decision", SAMPLES.request_decision, "person")
        .body,
    ).toBe(
      "Tu solicitud de vacaciones del 21/12/2026 al 24/12/2026 fue rechazada. Motivo: Cierre de inventario.",
    );
    expect(
      renderNotification("request_pending", SAMPLES.request_pending, "person"),
    ).toMatchObject({
      title: "Luis Pérez pide permiso",
      body: "Solicitud de permiso el 10/11/2026. Espera tu decisión.",
    });
  });

  it("opens the expediente for HR and the employee app for a manager", () => {
    expect(
      renderNotification("contract_ending", SAMPLES.contract_ending, "user")
        .url,
    ).toBe("/app/personas/00000000-0000-4000-8000-000000000001");
    expect(
      renderNotification("contract_ending", SAMPLES.contract_ending, "person")
        .url,
    ).toBe("/mi");
  });

  it("emails the same words with a link and how to stop the emails", () => {
    const email = notificationEmail(
      {
        title: "Tu recibo de nómina está listo",
        body: "Ya puedes ver <tu> recibo.",
        url: "/mi",
      },
      "https://workia.example",
      "person",
    );

    expect(email.subject).toBe("Tu recibo de nómina está listo");
    expect(email.text).toContain("https://workia.example/mi");
    expect(email.text).toContain("https://workia.example/mi/avisos");
    expect(email.html).toContain("&lt;tu&gt;");
    expect(email.html).not.toContain("<tu>");
  });
});
