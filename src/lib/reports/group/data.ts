import { and, asc, eq, isNull } from "drizzle-orm";

import { db, tdb } from "@/lib/db";
import { companies, personLinks } from "@/lib/db/schema";
import type { PermissionSlug } from "@/lib/db/schema/types";
import {
  getRolePermissionSlugs,
  isGroupAdmin,
  listActiveMemberships,
} from "@/lib/tenant/memberships";
import { withTenant } from "@/lib/tenant/scope";

import { loadAbsenteeismInputs } from "../absenteeism/data";

import { buildGroupDashboard, type CompanyInputs } from "./report";
import type { GroupFilter } from "./schema";

/** The subsidiaries whose reports a user may read, by name. */
export type GroupReportReader = {
  userId: string;
  isGroupAdmin: boolean;
  companies: Array<{ id: string; name: string }>;
};

const REPORTS_READ: PermissionSlug = "reports:read";

/**
 * Who reads what on the group dashboard: each company where the user's role
 * has reports:read (the permission of the per-company reports) and, with the
 * group admin grant of W2-24, every active company. Read on every request,
 * so a revoked membership or grant applies on the next one.
 */
export const loadGroupReportReader = async (
  userId: string,
): Promise<GroupReportReader> => {
  const [memberships, groupAdmin] = await Promise.all([
    listActiveMemberships(userId),
    isGroupAdmin(userId),
  ]);
  const readable = new Map<string, string>();
  const slugsByRole = new Map<string, Promise<PermissionSlug[]>>();

  for (const membership of memberships) {
    if (!slugsByRole.has(membership.roleId)) {
      slugsByRole.set(
        membership.roleId,
        getRolePermissionSlugs(membership.roleId),
      );
    }

    if ((await slugsByRole.get(membership.roleId)!).includes(REPORTS_READ)) {
      readable.set(membership.companyId, membership.companyName);
    }
  }

  if (groupAdmin) {
    // companies is a platform table, outside RLS.
    const rows = await db
      .select({ id: companies.id, name: companies.name })
      .from(companies)
      .where(and(eq(companies.status, "activa"), isNull(companies.deletedAt)))
      .orderBy(asc(companies.name));

    for (const row of rows) readable.set(row.id, row.name);
  }

  return {
    userId,
    isGroupAdmin: groupAdmin,
    companies: [...readable.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, "es")),
  };
};

/**
 * The transfers of `companyId` by the employment period each one closed or
 * opened, read under that company's RLS. Only ids: the other side's data
 * stays in its company.
 */
export const loadCompanyTransfers = async (
  companyId: string,
): Promise<CompanyInputs["transfers"]> => {
  const rows = await tdb(companyId)
    .select({
      periodId: personLinks.employmentPeriodId,
      direction: personLinks.direction,
      linkedCompanyId: personLinks.linkedCompanyId,
    })
    .from(personLinks)
    .where(withTenant(personLinks, companyId));

  return new Map(
    rows.map((row) => [
      row.periodId,
      { direction: row.direction, linkedCompanyId: row.linkedCompanyId },
    ]),
  );
};

/**
 * Companies read at once. Each one is five statements in parallel; two at a
 * time keeps a page view within a handful of connections on Neon Free.
 */
const COMPANY_CONCURRENCY = 2;

/** The companies of the view: the selected ones the reader may see, or all of them. */
export const companiesInView = (
  reader: GroupReportReader,
  filter: GroupFilter,
) =>
  filter.companyIds.length === 0
    ? reader.companies
    : reader.companies.filter((company) =>
        filter.companyIds.includes(company.id),
      );

/**
 * The group dashboard of `reader` for `filter`: every company of the view
 * read with its own id, under its own row-level security, with the same
 * inputs as its absenteeism report, then built by buildGroupDashboard.
 * Nothing is stored; every number is computed on this read.
 */
export const getGroupDashboard = async (
  reader: GroupReportReader,
  filter: GroupFilter,
  today: string,
) => {
  const view = companiesInView(reader, filter);
  const inputs: CompanyInputs[] = [];

  for (let index = 0; index < view.length; index += COMPANY_CONCURRENCY) {
    const batch = await Promise.all(
      view
        .slice(index, index + COMPANY_CONCURRENCY)
        .map(async (company): Promise<CompanyInputs> => {
          const [loaded, transfers] = await Promise.all([
            loadAbsenteeismInputs(company.id, filter),
            loadCompanyTransfers(company.id),
          ]);

          return {
            companyId: company.id,
            companyName: company.name,
            facts: loaded.facts,
            sites: loaded.structure.sites,
            regions: loaded.structure.regions,
            absenteeism: loaded.absenteeism,
            incidencias: loaded.incidencias,
            transfers,
          };
        }),
    );

    inputs.push(...batch);
  }

  return buildGroupDashboard({ companies: inputs, filter, today });
};
