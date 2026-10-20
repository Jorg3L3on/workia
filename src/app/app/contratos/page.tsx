import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { FileTextIcon } from "lucide-react";

import { RenewalTrayList } from "@/components/contracts/renewal-tray-list";
import { SectionSkeleton } from "@/components/loading/page-skeletons";
import { PageHeader } from "@/components/layout/page-header";
import { pageTitles } from "@/lib/brand/chrome-copy";
import {
  listActiveContractTemplates,
  listRenewalTrayItems,
} from "@/lib/contracts";
import { requireContractsRead } from "@/lib/contracts/auth";
import { listRegions } from "@/lib/regions";
import { listActivePositions } from "@/lib/catalog";
import { userHasPermission } from "@/lib/rbac";
import { isoToday } from "@/lib/format/date";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: pageTitles.contratos,
};

type ContratosPageProps = {
  searchParams: Promise<{
    renewed?: string;
    "no-renew"?: string;
    error?: string;
    region?: string;
    constancia?: string;
  }>;
};

const RenewalTray = async ({
  canUpdate,
  canSeeCompensation,
  companyId,
  region,
}: {
  canUpdate: boolean;
  canSeeCompensation: boolean;
  companyId: string;
  region?: string;
}) => {
  const regions = await listRegions(companyId);
  // Only a region of this company filters; anything else is ignored.
  const regionId = regions.some((item) => item.id === region)
    ? region
    : undefined;
  const [renewalItems, templates, positions] = await Promise.all([
    listRenewalTrayItems(companyId, undefined, undefined, {
      compensation: canSeeCompensation,
      regionId,
    }),
    listActiveContractTemplates(companyId),
    canUpdate ? listActivePositions(companyId) : [],
  ]);

  return (
    <>
      <RenewalTrayList
        canSeeCompensation={canSeeCompensation}
        canUpdate={canUpdate}
        items={renewalItems}
        region={regionId ?? ""}
        regions={regions.map((item) => ({ id: item.id, name: item.name }))}
        positions={positions.map((position) => ({
          id: position.id,
          name: position.name,
        }))}
        templates={templates}
        today={isoToday()}
      />
    </>
  );
};

const ContratosPage = async ({ searchParams }: ContratosPageProps) => {
  const session = await requireContractsRead();
  const {
    renewed,
    "no-renew": noRenew,
    error,
    region,
    constancia: constanciaParam,
  } = await searchParams;
  // Only a uuid goes into the link.
  const constancia = /^[0-9a-f-]{36}$/i.test(constanciaParam ?? "")
    ? constanciaParam
    : undefined;

  const [canUpdate, canManageTemplates, canSeeCompensation] = await Promise.all(
    [
      userHasPermission(session.user.id, "contracts:update"),
      userHasPermission(session.user.id, "contract_templates:read"),
      userHasPermission(session.user.id, "compensation:read"),
    ],
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        description="Renovaciones dentro de la ventana de aviso."
        menu={[
          canManageTemplates && {
            label: "Plantillas",
            icon: FileTextIcon,
            href: "/app/contratos/plantillas",
          },
        ]}
        title="Contratos"
      />

      {renewed === "1" ? (
        <p
          className="text-sm font-medium text-[color:var(--workia-accent-blue)]"
          role="status"
        >
          Contrato renovado correctamente.
          {constancia ? (
            <>
              {" "}
              <Link
                className="underline"
                href={`/app/personas/${constancia}/constancia`}
              >
                Ver constancia de antigüedad
              </Link>
            </>
          ) : null}
        </p>
      ) : null}

      {noRenew === "1" ? (
        <p
          className="text-sm font-medium text-[color:var(--workia-accent-blue)]"
          role="status"
        >
          Decisión registrada: no renovar. La persona permanece activa.
        </p>
      ) : null}

      {error === "no-renew-permission" ? (
        <p className="text-destructive text-sm" role="alert">
          No tienes permiso para registrar decisiones de renovación.
        </p>
      ) : null}

      <Suspense fallback={<SectionSkeleton />}>
        <RenewalTray
          canSeeCompensation={canSeeCompensation}
          canUpdate={canUpdate}
          companyId={session.companyId}
          region={region}
        />
      </Suspense>
    </div>
  );
};

export default ContratosPage;
