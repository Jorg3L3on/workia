import { getPersonWithRelations } from "@/lib/people";
import { getEmploymentSummary } from "@/lib/people/employment";
import { formatPersonName } from "@/lib/people/schema";
import { vacationPeriodFor } from "@/lib/people/vacation";
import { vacationAsOf } from "@/lib/people/vacation-card";
import { getCompanyById } from "@/lib/tenant/companies";

import { composeVacationConstancia } from "./constancia-sheet";
import { listVacationRecords } from "./index";

export type {
  VacationConstancia,
  VacationConstanciaRange,
} from "./constancia-sheet";

/**
 * Loads one person's vacation constancia inside `companyId` (WRK-I14-4).
 * Null when the person is not in the company, when no service year is
 * complete by `asOf` (or by the fecha de baja), or when `serviceYear` is
 * still ahead of that date. Omit `serviceYear` to use the year that
 * contains the date. Days taken are non-voided ledger rows of that year.
 *
 * pendiente de contador: the grant-by date and the year-6 day count are the
 * engine's readings (see constancia-sheet.ts). This loader does not add one.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const getVacationConstancia = async (
  companyId: string,
  personId: string,
  asOf: string,
  serviceYear: number | null = null,
) => {
  if (!UUID.test(personId)) {
    return null;
  }

  const person = await getPersonWithRelations(companyId, personId, true);

  if (!person) {
    return null;
  }

  const [company, employment, records] = await Promise.all([
    getCompanyById(companyId),
    getEmploymentSummary(companyId, personId),
    listVacationRecords(companyId, personId),
  ]);
  const seniorityDate = employment
    ? employment.fechaAntiguedad
    : person.fechaIngreso;
  const countedTo = vacationAsOf({
    status: person.status,
    fechaBaja: employment?.fechaBaja ?? null,
    today: asOf,
  });

  if (!seniorityDate || !countedTo) {
    return null;
  }

  const current = vacationPeriodFor(seniorityDate, countedTo);

  if (
    !current ||
    current.proportionalOnly ||
    current.serviceYearsCompleted < 1
  ) {
    return null;
  }

  const year = serviceYear ?? current.serviceYearsCompleted;

  if (
    !Number.isInteger(year) ||
    year < 1 ||
    year > current.serviceYearsCompleted
  ) {
    return null;
  }

  return composeVacationConstancia({
    companyName: company?.legalName || company?.name || "La empresa",
    personName: formatPersonName(person),
    seniorityDate,
    serviceYear: year,
    asOf: countedTo,
    entries: records.map((record) => ({
      startDate: record.startDate,
      endDate: record.endDate,
      serviceYear: record.serviceYear,
      days: record.days,
      voided: false,
    })),
  });
};
