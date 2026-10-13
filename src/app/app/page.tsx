import type { Metadata } from "next";

import { TodayDashboard } from "@/components/home/today-dashboard";
import { pageTitles } from "@/lib/brand/chrome-copy";
import { requireCompanyPage } from "@/lib/tenant/context";
import { countRenewalTrayItems, listRenewalTrayItems } from "@/lib/contracts";
import { countActivePeople } from "@/lib/people";
import { userHasPermission } from "@/lib/rbac";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: pageTitles.inicio,
};

export default async function AppPage() {
  const session = await requireCompanyPage();

  const canReadPeople = await userHasPermission(session.user.id, "people:read");
  const canReadContracts = await userHasPermission(
    session.user.id,
    "contracts:read",
  );

  const [activePeopleCount, canManagePeople, renewalItems, urgentCount] =
    await Promise.all([
      canReadPeople ? countActivePeople(session.companyId) : Promise.resolve(0),
      userHasPermission(session.user.id, "people:create"),
      canReadContracts
        ? listRenewalTrayItems(session.companyId, undefined, 5)
        : Promise.resolve([]),
      canReadContracts
        ? countRenewalTrayItems(session.companyId)
        : Promise.resolve(0),
    ]);

  return (
    <TodayDashboard
      activePeopleCount={activePeopleCount}
      canManagePeople={canManagePeople}
      canReadContracts={canReadContracts}
      canReadPeople={canReadPeople}
      renewalItems={renewalItems}
      urgentCount={urgentCount}
    />
  );
}
