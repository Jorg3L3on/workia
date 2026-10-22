import { listTerminationReasons } from "@/lib/termination-reasons";

import { isOpenPeriod, listEmploymentPeriods } from "./employment";

/**
 * What the expediente's ⋯ menu needs for «Dar de baja», «Reingresar» and
 * «Finiquito» (Iniciativa 2). The finiquito amount only reaches a viewer
 * with compensation:read.
 */
export const getPersonEmploymentMenuData = async (
  companyId: string,
  personId: string,
  canSeeCompensation: boolean,
) => {
  const [periods, reasons] = await Promise.all([
    listEmploymentPeriods(companyId, personId),
    listTerminationReasons(companyId, { activeOnly: true }),
  ]);
  const current = periods.find(isOpenPeriod) ?? periods.at(-1) ?? null;
  const closed = periods.filter((period) => !isOpenPeriod(period)).at(-1);

  return {
    reasons: reasons.map((reason) => ({ id: reason.id, name: reason.name })),
    fechaIngreso: current?.fechaIngreso ?? null,
    lastBaja: closed
      ? {
          fechaBaja: closed.fechaBaja,
          recontratable: closed.recontratable,
          finiquitoEstado: closed.finiquitoEstado,
          finiquitoFecha: closed.finiquitoFecha,
          finiquitoMonto: canSeeCompensation ? closed.finiquitoMonto : null,
          hasFiniquitoMonto: closed.finiquitoMonto !== null,
        }
      : null,
    canSeeCompensation,
  };
};
