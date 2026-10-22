import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { FiniquitoFields } from "@/components/people/finiquito-fields";

afterEach(cleanup);

describe("FiniquitoFields", () => {
  it("masks the amount and never posts it without compensation:read", () => {
    const { container } = render(
      <FiniquitoFields
        canSeeAmount={false}
        hasAmount
        idPrefix="f-"
        initial={{ estado: "pagado", fecha: "2026-01-15", monto: null }}
      />,
    );

    const amount = screen.getByLabelText("Monto (MXN)") as HTMLInputElement;
    expect(amount.value).toBe("•••");
    expect(amount.disabled).toBe(true);
    expect(container.querySelector('[name="finiquitoMonto"]')).toBeNull();
  });

  it("edits the amount with compensation:read", () => {
    const { container } = render(
      <FiniquitoFields
        canSeeAmount
        idPrefix="f-"
        initial={{ estado: "pagado", fecha: null, monto: "15000.00" }}
      />,
    );

    expect(
      (container.querySelector('[name="finiquitoMonto"]') as HTMLInputElement)
        .value,
    ).toBe("15000");
  });
});
