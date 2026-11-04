import { and, eq, isNull } from "drizzle-orm";

import { tdb } from "@/lib/db";
import {
  areas,
  companies,
  employeeAccounts,
  people,
  positions,
  sites,
} from "@/lib/db/schema";
import type { EmployeeContext } from "@/lib/employee-accounts/sign-in";
import { withTenant } from "@/lib/tenant/scope";

/**
 * What /mi shows the signed-in employee about themselves (W2-01): name,
 * company, puesto, área, sucursal and the account email. Read only with the
 * guard's company and person, never with an id from the request. W2-02 Mi
 * expediente builds the full view on this.
 */
export const getEmployeeHome = async (context: EmployeeContext) => {
  const [row] = await tdb(context.companyId)
    .select({
      personId: people.id,
      nombres: people.nombres,
      apellidoPaterno: people.apellidoPaterno,
      apellidoMaterno: people.apellidoMaterno,
      companyName: companies.name,
      positionName: positions.name,
      areaName: areas.name,
      siteName: sites.name,
      email: employeeAccounts.email,
    })
    .from(people)
    .innerJoin(companies, eq(companies.id, people.companyId))
    .innerJoin(
      employeeAccounts,
      and(
        eq(employeeAccounts.companyId, people.companyId),
        eq(employeeAccounts.personId, people.id),
        eq(employeeAccounts.id, context.accountId),
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
    .where(
      withTenant(
        people,
        context.companyId,
        eq(people.id, context.personId),
        isNull(people.deletedAt),
      ),
    )
    .limit(1);

  return row ?? null;
};

export type EmployeeHome = NonNullable<
  Awaited<ReturnType<typeof getEmployeeHome>>
>;
