import { TodayDashboard } from "@/components/home/today-dashboard";
import { requireAuth } from "@/lib/auth/session";
import { countRenewalTrayItems, listRenewalTrayItems } from "@/lib/contracts";
import { countActivePeople } from "@/lib/people";
import { userHasPermission } from "@/lib/rbac";

export const dynamic = "force-dynamic";

export default async function AppPage() {
  const session = await requireAuth();

  const canReadPeople = await userHasPermission(session.user.id, "people:read");
  const canReadContracts = await userHasPermission(
    session.user.id,
    "contracts:read",
  );

  const [activePeopleCount, canManagePeople, renewalItems, urgentCount] =
    await Promise.all([
      canReadPeople ? countActivePeople() : Promise.resolve(0),
      userHasPermission(session.user.id, "people:create"),
      canReadContracts ? listRenewalTrayItems() : Promise.resolve([]),
      canReadContracts ? countRenewalTrayItems() : Promise.resolve(0),
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
