import type { Metadata } from "next";
import Link from "next/link";
import { forbidden, notFound } from "next/navigation";

import { PageHeader } from "@/components/layout/page-header";
import { DecisionForm } from "@/components/requests/decision-form";
import { RequestDetails } from "@/components/requests/request-details";
import { pageTitles } from "@/lib/brand/chrome-copy";
import {
  getCompanyRequest,
  HR_DECIDE_PERMISSION,
  TIME_OFF_KIND_LABELS,
} from "@/lib/requests";
import { decideRequestByHrAction } from "@/lib/requests/actions";
import { requireCompanyPage } from "@/lib/tenant/context";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: pageTitles.solicitud };

type HrRequestPageProps = { params: Promise<{ id: string }> };

/**
 * One request for HR (W2-06): what was asked, what to weigh and, with
 * vacations:update, the decision. HR can decide any pending request of its
 * company, also when the jefe cannot.
 */
const HrRequestPage = async ({ params }: HrRequestPageProps) => {
  const session = await requireCompanyPage();

  if (!session.permissions.has("vacations:read")) {
    forbidden();
  }

  const { id } = await params;
  const request = await getCompanyRequest(session.companyId, id);

  if (!request) {
    notFound();
  }

  const canDecide =
    request.status === "pending" &&
    session.permissions.has(HR_DECIDE_PERMISSION);

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <PageHeader
        description={request.personName}
        title={TIME_OFF_KIND_LABELS[request.kind]}
      />
      <RequestDetails request={request} />
      {canDecide ? (
        <section className="space-y-3 rounded-lg border px-5 py-4">
          {request.approverName ? (
            <p className="text-muted-foreground text-sm">
              La decide {request.approverName}. Si RH la decide, queda a nombre
              de RH.
            </p>
          ) : null}
          <DecisionForm
            action={decideRequestByHrAction}
            hidden={{ requestId: request.id, companyId: session.companyId }}
          />
        </section>
      ) : null}
      <Link
        className="text-sm font-medium text-[color:var(--workia-accent-blue)]"
        href={`/app/personas/${request.personId}`}
      >
        Ver expediente
      </Link>
    </div>
  );
};

export default HrRequestPage;
