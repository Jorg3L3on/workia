import { TodayDashboard } from "@/components/home/today-dashboard";
import { requireAuth } from "@/lib/auth/session";
import { countActivePeople } from "@/lib/people";
import { userHasPermission } from "@/lib/rbac";

export const dynamic = "force-dynamic";

export default async function AppPage() {
  const session = await requireAuth();

  const canReadPeople = await userHasPermission(session.user.id, "people:read");

  const [activePeopleCount, canManagePeople] = await Promise.all([
    canReadPeople ? countActivePeople() : Promise.resolve(0),
    userHasPermission(session.user.id, "people:create"),
  ]);

  const urgentCount = 0;

  return (
    <TodayDashboard
      activePeopleCount={activePeopleCount}
      canManagePeople={canManagePeople}
      canReadPeople={canReadPeople}
      urgentCount={urgentCount}
    />
  );
}
