import type { Metadata } from "next";

import { TeamPageHeader } from "@/components/manager/team-page-header";
import { RequestForm } from "@/components/requests/request-form";
import { requireEmployeeContext } from "@/lib/employee-accounts/session";
import { isoToday } from "@/lib/format/date";

export const metadata: Metadata = { title: "Pedir vacaciones o permiso" };

/** The request form (W2-06). The person is the session's. */
const NewRequestPage = async () => {
  await requireEmployeeContext();

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-xl flex-col gap-4 px-4 pt-6 pb-10">
      <TeamPageHeader
        backHref="/mi/solicitudes"
        backLabel="Mis solicitudes"
        title="Pedir vacaciones o permiso"
      />
      <section className="workia-pass-card px-5 py-4">
        <RequestForm today={isoToday()} />
      </section>
    </main>
  );
};

export default NewRequestPage;
