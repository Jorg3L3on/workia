import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { TeamPageHeader } from "@/components/manager/team-page-header";
import { DecisionForm } from "@/components/requests/decision-form";
import { RequestDetails } from "@/components/requests/request-details";
import { decideRequestAction } from "@/lib/employee/request-actions";
import { requireEmployeeContext } from "@/lib/employee-accounts/session";
import { getManagerAccess } from "@/lib/managers";
import { getRequestForManager, TIME_OFF_KIND_LABELS } from "@/lib/requests";

export const metadata: Metadata = { title: "Solicitud" };

type RequestDecisionPageProps = { params: Promise<{ requestId: string }> };

/**
 * One request in the manager's inbox (W2-06): what is asked, what to weigh,
 * and approve or reject. A request the account does not decide for, in this
 * company or another, is a 404.
 */
const RequestDecisionPage = async ({ params }: RequestDecisionPageProps) => {
  const context = await requireEmployeeContext();
  const access = await getManagerAccess(context);

  if (!access) {
    notFound();
  }

  const { requestId } = await params;
  const request = await getRequestForManager(access, requestId);

  if (!request) {
    notFound();
  }

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-xl flex-col gap-4 px-4 pt-6 pb-10">
      <TeamPageHeader
        backHref="/mi/equipo/aprobaciones"
        backLabel="Aprobaciones"
        title={TIME_OFF_KIND_LABELS[request.kind]}
        subtitle={request.personName}
      />
      <RequestDetails request={request} />
      {request.status === "pending" ? (
        <section className="workia-pass-card px-5 py-4">
          <DecisionForm
            action={decideRequestAction}
            hidden={{ requestId: request.id }}
          />
        </section>
      ) : null}
    </main>
  );
};

export default RequestDecisionPage;
