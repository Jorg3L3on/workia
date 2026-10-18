/**
 * Compensation on contracts (WRK-I5-2): stored with the derived monthly
 * salary, kept on a renewal that does not send it, and ignored when posted by
 * someone without compensation:read.
 */
import { beforeAll, describe, expect, it } from "vitest";

import {
  createContract,
  getContractById,
  getVigenteContractForPerson,
  renewContract,
  softDeleteContract,
} from "@/lib/contracts";
import {
  createContractAction,
  renewContractAction,
} from "@/lib/contracts/actions";

import { seedTenant, type Tenant } from "./fixtures";
import { actAs } from "./session-state";

let t: Tenant;

const formData = (values: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
};

const base = (personId: string, templateId: string) => ({
  personId,
  templateId,
  type: "indeterminado" as const,
  startDate: "2026-09-01",
  endDate: "",
  noticeWindow: "no_avisar" as const,
});

const run = async (action: () => Promise<unknown>) => {
  try {
    return await action();
  } catch (error) {
    return { redirect: (error as { url?: string }).url };
  }
};

beforeAll(async () => {
  t = await seedTenant("COMP");
  // The fixture's contract belongs to t.person; start each case clean.
  await softDeleteContract(t.companyId, t.contract.id, t.admin.id);
});

describe("contract compensation", () => {
  it("stores the daily salary and derives the monthly one (× 30.4)", async () => {
    const created = await createContract(
      t.companyId,
      {
        ...base(t.person.id, t.template.id),
        salarioDiario: 500,
        formaPago: "transferencia",
        periodicidadPago: "quincenal",
        diaPago: "15 y último",
      },
      t.admin.id,
    );

    expect(created).toMatchObject({
      salarioDiario: "500.00",
      salarioMensual: "15200.00",
      formaPago: "transferencia",
      periodicidadPago: "quincenal",
      diaPago: "15 y último",
    });
  });

  it("a renewal that does not send the salary keeps the previous one", async () => {
    const current = await getVigenteContractForPerson(t.companyId, t.person.id);
    const renewed = await renewContract(
      t.companyId,
      {
        ...base(t.person.id, t.template.id),
        contractId: current!.id,
        startDate: "2027-09-01",
      },
      t.admin.id,
    );

    expect(renewed.salarioDiario).toBe("500.00");
    expect(renewed.salarioMensual).toBe("15200.00");
    expect(renewed.formaPago).toBe("transferencia");
    // The previous contract keeps its own frozen compensation.
    const previous = await getContractById(t.companyId, current!.id);
    expect(previous?.salarioDiario).toBe("500.00");
  });

  it("a renewal with a new salary freezes the new one; empty clears it", async () => {
    const current = await getVigenteContractForPerson(t.companyId, t.person.id);
    const raised = await renewContract(
      t.companyId,
      {
        ...base(t.person.id, t.template.id),
        contractId: current!.id,
        startDate: "2028-09-01",
        salarioDiario: 600,
        formaPago: "efectivo",
        periodicidadPago: "semanal",
      },
      t.admin.id,
    );
    expect(raised.salarioMensual).toBe("18240.00");
    expect(raised.diaPago).toBeNull();

    const cleared = await renewContract(
      t.companyId,
      {
        ...base(t.person.id, t.template.id),
        contractId: raised.id,
        startDate: "2029-09-01",
        salarioDiario: "",
      },
      t.admin.id,
    );
    expect(cleared.salarioDiario).toBeNull();
    expect(cleared.formaPago).toBeNull();
  });

  it("an editor without compensation:read cannot set a salary by posting it", async () => {
    actAs(t.editor);
    const result = await run(() =>
      createContractAction(
        {},
        formData({
          ...base(t.teammate.id, t.template.id),
          companyId: t.companyId,
          salarioDiario: "999",
          formaPago: "efectivo",
          periodicidadPago: "semanal",
        }),
      ),
    );
    expect(result).toEqual({
      redirect: `/app/personas/${t.teammate.id}?contract=created`,
    });

    const created = await getVigenteContractForPerson(
      t.companyId,
      t.teammate.id,
    );
    expect(created?.salarioDiario).toBeNull();
  });

  it("an editor's renewal keeps the salary an admin captured", async () => {
    actAs(t.admin);
    const current = await getVigenteContractForPerson(
      t.companyId,
      t.teammate.id,
    );
    await run(() =>
      renewContractAction(
        {},
        formData({
          ...base(t.teammate.id, t.template.id),
          contractId: current!.id,
          companyId: t.companyId,
          startDate: "2027-01-01",
          salarioDiario: "400",
          formaPago: "cheque",
          periodicidadPago: "mensual",
        }),
      ),
    );
    const withSalary = await getVigenteContractForPerson(
      t.companyId,
      t.teammate.id,
    );
    expect(withSalary?.salarioDiario).toBe("400.00");

    actAs(t.editor);
    await run(() =>
      renewContractAction(
        {},
        formData({
          ...base(t.teammate.id, t.template.id),
          contractId: withSalary!.id,
          companyId: t.companyId,
          startDate: "2028-01-01",
          salarioDiario: "1",
          formaPago: "efectivo",
          periodicidadPago: "semanal",
        }),
      ),
    );
    const renewed = await getVigenteContractForPerson(
      t.companyId,
      t.teammate.id,
    );
    expect(renewed?.id).not.toBe(withSalary!.id);
    expect(renewed?.salarioDiario).toBe("400.00");
    expect(renewed?.formaPago).toBe("cheque");
  });
});
