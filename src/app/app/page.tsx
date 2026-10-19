import type { Metadata } from "next";

import { TodayDashboard } from "@/components/home/today-dashboard";
import { pageTitles } from "@/lib/brand/chrome-copy";
import { listActivePositions } from "@/lib/catalog";
import {
  countRenewalTrayItems,
  listActiveContractTemplates,
  listRenewalTrayItems,
} from "@/lib/contracts";
import { isoToday } from "@/lib/format/date";
import { listOnboardings } from "@/lib/onboarding";
import { countActivePeople } from "@/lib/people";
import { formatPersonName } from "@/lib/people/schema";
import { userHasPermission } from "@/lib/rbac";
import { listAssetsToRecover } from "@/lib/resguardo";
import { requireCompanyPage } from "@/lib/tenant/context";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: pageTitles.inicio,
};

const HOME_LIST_LIMIT = 5;

export default async function AppPage() {
  const session = await requireCompanyPage();
  const { companyId } = session;
  const can = (permission: Parameters<typeof userHasPermission>[1]) =>
    userHasPermission(session.user.id, permission);

  const [
    canReadPeople,
    canCreatePeople,
    canReadContracts,
    canUpdateContracts,
    canSeeCompensation,
    canReadAssets,
  ] = await Promise.all([
    can("people:read"),
    can("people:create"),
    can("contracts:read"),
    can("contracts:update"),
    can("compensation:read"),
    can("assets:read"),
  ]);

  const [
    activePeopleCount,
    renewalItems,
    renewalCount,
    templates,
    positions,
    onboardings,
    assetsToRecover,
  ] = await Promise.all([
    canReadPeople ? countActivePeople(companyId) : 0,
    canReadContracts
      ? listRenewalTrayItems(companyId, undefined, HOME_LIST_LIMIT, {
          compensation: canSeeCompensation,
        })
      : [],
    canReadContracts ? countRenewalTrayItems(companyId) : 0,
    canUpdateContracts ? listActiveContractTemplates(companyId) : [],
    canUpdateContracts ? listActivePositions(companyId) : [],
    canReadPeople ? listOnboardings(companyId) : [],
    canReadAssets ? listAssetsToRecover(companyId, HOME_LIST_LIMIT) : null,
  ]);

  const openOnboardings = onboardings.filter(
    (row) =>
      row.onboarding.stage === "rh_captura" ||
      row.onboarding.stage === "pendiente_nominas",
  );

  return (
    <TodayDashboard
      activePeopleCount={canReadPeople ? activePeopleCount : null}
      assetsToRecover={assetsToRecover}
      canCreatePeople={canCreatePeople}
      canSeeCompensation={canSeeCompensation}
      onboardings={
        canReadPeople
          ? {
              total: openOnboardings.length,
              items: openOnboardings.slice(0, HOME_LIST_LIMIT).map((row) => ({
                id: row.onboarding.id,
                personName: formatPersonName(row.person),
                stage: row.onboarding.stage,
              })),
            }
          : null
      }
      positions={positions.map((position) => ({
        id: position.id,
        name: position.name,
      }))}
      renewals={
        canReadContracts ? { total: renewalCount, items: renewalItems } : null
      }
      templates={templates}
      today={isoToday()}
    />
  );
}
