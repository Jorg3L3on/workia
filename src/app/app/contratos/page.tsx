import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { FileTextIcon } from "lucide-react";

import { RenewalTrayList } from "@/components/contracts/renewal-tray-list";
import { SectionSkeleton } from "@/components/loading/page-skeletons";
import { ListPageHeader } from "@/components/list/list-page-header";
import { pageTitles } from "@/lib/brand/chrome-copy";
import { Button } from "@/components/ui/button";
import {
  listActiveContractTemplates,
  listRenewalTrayItems,
} from "@/lib/contracts";
import { requireContractsRead } from "@/lib/contracts/auth";
import { RegionFilter } from "@/components/list/region-filter";
import { listRegions } from "@/lib/regions";
import { listActivePositions } from "@/lib/catalog";
import { userHasPermission } from "@/lib/rbac";

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
      <RegionFilter
        id="renewal-region"
        regions={regions.map((item) => ({ id: item.id, name: item.name }))}
        value={regionId ?? ""}
      />
      <RenewalTrayList
        canSeeCompensation={canSeeCompensation}
        canUpdate={canUpdate}
        items={renewalItems}
        positions={positions.map((position) => ({
          id: position.id,
          name: position.name,
        }))}
        templates={templates}
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
      <ListPageHeader
        actions={
          canManageTemplates ? (
            <Button asChild className="h-10 rounded-full" variant="outline">
              <Link href="/app/contratos/plantillas">
                <FileTextIcon className="size-4" aria-hidden />
                Plantillas
              </Link>
            </Button>
          ) : undefined
        }
        description="Bandeja de renovaciones según la ventana de aviso de cada contrato."
        descriptionSecondary="Lista de contratos en seguimiento."
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

      <div className="space-y-3">
        <div>
          <h2 className="text-base font-semibold">Renovaciones pendientes</h2>
          <p className="text-muted-foreground text-sm">
            Contratos en ventana de aviso
          </p>
        </div>

        <Suspense fallback={<SectionSkeleton />}>
          <RenewalTray
            canSeeCompensation={canSeeCompensation}
            canUpdate={canUpdate}
            companyId={session.companyId}
            region={region}
          />
        </Suspense>
      </div>
    </div>
  );
};

export default ContratosPage;
