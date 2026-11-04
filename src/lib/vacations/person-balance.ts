import { getPersonWithRelations } from "@/lib/people";
import { getEmploymentSummary } from "@/lib/people/employment";

import { listVacationRecords } from "./index";
import { composeVacationBalance, type VacationBalanceSummary } from "./summary";

export type {
  VacationBalanceRecord,
  VacationBalanceSummary,
  VacationYearLine,
} from "./summary";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One person's vacation balance inside `companyId` (W2-05), for the employee
 * view. Same inputs and the same `composeVacationBalance` as the HR card in
 * the expediente, so both show the same numbers. Null when the person is not
 * in the company or was deleted (the same answer a missing id gets).
 *
 * The caller is responsible for who may read it: the employee guard passes
 * only the signed-in employee's own person id. `today` is passed in.
 */
export const getPersonVacationBalance = async (
  companyId: string,
  personId: string,
  today: string,
): Promise<VacationBalanceSummary | null> => {
  if (!UUID.test(personId)) {
    return null;
  }

  const person = await getPersonWithRelations(companyId, personId);

  if (!person) {
    return null;
  }

  const [employment, records] = await Promise.all([
    getEmploymentSummary(companyId, personId),
    listVacationRecords(companyId, personId),
  ]);

  return composeVacationBalance({
    seniorityDate: employment
      ? employment.fechaAntiguedad
      : person.fechaIngreso,
    status: person.status,
    fechaBaja: employment?.fechaBaja ?? null,
    today,
    records,
  });
};
