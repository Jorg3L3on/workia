import { and, desc, eq, isNull } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { tdb } from "@/lib/db";
import {
  areas,
  companies,
  contracts,
  employeeAccounts,
  people,
  personSchedules,
  positions,
  sites,
} from "@/lib/db/schema";
import type { EmployeeContext } from "@/lib/employee-accounts/sign-in";
import {
  listEmploymentPeriods,
  summarizePeriods,
} from "@/lib/people/employment";
import { withTenant } from "@/lib/tenant/scope";

import type { ExpedienteData } from "./expediente-model";

/**
 * Mi expediente (Workia 2.0 W2-02): the signed-in employee's own record,
 * read only with the guard's company and person, never an id from the
 * request. Three queries: the person with its catalog names, manager and
 * schedule; the employment periods (seniority); the vigente contract without
 * its amounts. Null when the person is gone (the page answers 404).
 */
export const getEmployeeExpediente = async (
  context: EmployeeContext,
): Promise<ExpedienteData | null> => {
  const { companyId, personId, accountId } = context;
  const manager = alias(people, "manager");
  const db = tdb(companyId);

  const [[row], periods, [contract]] = await Promise.all([
    db
      .select({
        person: {
          nombres: people.nombres,
          apellidoPaterno: people.apellidoPaterno,
          apellidoMaterno: people.apellidoMaterno,
          fechaNacimiento: people.fechaNacimiento,
          fechaIngreso: people.fechaIngreso,
          curp: people.curp,
          rfc: people.rfc,
          nss: people.nss,
          sexo: people.sexo,
          estadoCivil: people.estadoCivil,
          lugarNacimiento: people.lugarNacimiento,
          nacionalidad: people.nacionalidad,
          email: people.email,
          telefono: people.telefono,
          domicilioCalle: people.domicilioCalle,
          domicilioNumeroExterior: people.domicilioNumeroExterior,
          domicilioNumeroInterior: people.domicilioNumeroInterior,
          domicilioColonia: people.domicilioColonia,
          domicilioMunicipio: people.domicilioMunicipio,
          domicilioEstado: people.domicilioEstado,
          domicilioCodigoPostal: people.domicilioCodigoPostal,
          status: people.status,
        },
        companyName: companies.name,
        accountEmail: employeeAccounts.email,
        positionName: positions.name,
        areaName: areas.name,
        siteName: sites.name,
        managerId: manager.id,
        managerNombres: manager.nombres,
        managerApellidoPaterno: manager.apellidoPaterno,
        managerApellidoMaterno: manager.apellidoMaterno,
        scheduleId: personSchedules.id,
        schedule: {
          entrada: personSchedules.entrada,
          salidaComer: personSchedules.salidaComer,
          regresoComer: personSchedules.regresoComer,
          salida: personSchedules.salida,
          blocks: personSchedules.blocks,
          restDay: personSchedules.restDay,
        },
      })
      .from(people)
      .innerJoin(companies, eq(companies.id, people.companyId))
      .innerJoin(
        employeeAccounts,
        and(
          eq(employeeAccounts.companyId, people.companyId),
          eq(employeeAccounts.personId, people.id),
          eq(employeeAccounts.id, accountId),
        ),
      )
      .leftJoin(
        positions,
        and(
          eq(positions.companyId, people.companyId),
          eq(positions.id, people.positionId),
        ),
      )
      .leftJoin(
        areas,
        and(eq(areas.companyId, people.companyId), eq(areas.id, people.areaId)),
      )
      .leftJoin(
        sites,
        and(eq(sites.companyId, people.companyId), eq(sites.id, people.siteId)),
      )
      .leftJoin(
        manager,
        and(
          eq(manager.companyId, people.companyId),
          eq(manager.id, people.managerId),
          isNull(manager.deletedAt),
        ),
      )
      .leftJoin(
        personSchedules,
        and(
          eq(personSchedules.companyId, people.companyId),
          eq(personSchedules.personId, people.id),
          isNull(personSchedules.deletedAt),
        ),
      )
      .where(
        withTenant(
          people,
          companyId,
          eq(people.id, personId),
          isNull(people.deletedAt),
        ),
      )
      .limit(1),
    listEmploymentPeriods(companyId, personId),
    db
      .select({
        type: contracts.type,
        status: contracts.status,
        startDate: contracts.startDate,
        endDate: contracts.endDate,
      })
      .from(contracts)
      .where(
        withTenant(
          contracts,
          companyId,
          eq(contracts.personId, personId),
          eq(contracts.status, "vigente"),
          isNull(contracts.deletedAt),
        ),
      )
      .orderBy(desc(contracts.startDate))
      .limit(1),
  ]);

  if (!row) {
    return null;
  }

  const summary = summarizePeriods(periods);

  return {
    person: row.person,
    companyName: row.companyName,
    accountEmail: row.accountEmail,
    positionName: row.positionName,
    areaName: row.areaName,
    siteName: row.siteName,
    manager:
      row.managerId && row.managerNombres && row.managerApellidoPaterno
        ? {
            nombres: row.managerNombres,
            apellidoPaterno: row.managerApellidoPaterno,
            apellidoMaterno: row.managerApellidoMaterno,
          }
        : null,
    schedule: row.scheduleId ? row.schedule : null,
    period: summary
      ? {
          fechaIngreso: summary.fechaIngreso,
          fechaAntiguedad: summary.fechaAntiguedad,
        }
      : null,
    contract: contract ?? null,
  };
};
