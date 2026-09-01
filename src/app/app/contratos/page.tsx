import type { Metadata } from "next";
import Link from "next/link";
import { FileTextIcon } from "lucide-react";

import { RenewalTrayList } from "@/components/contracts/renewal-tray-list";
import { ListPageHeader } from "@/components/list/list-page-header";
import { pageTitles } from "@/lib/brand/chrome-copy";
import { Button } from "@/components/ui/button";
import {
  listActiveContractTemplates,
  listRenewalTrayItems,
} from "@/lib/contracts";
import { requireContractsRead } from "@/lib/contracts/auth";
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
  }>;
};

const ContratosPage = async ({ searchParams }: ContratosPageProps) => {
  const session = await requireContractsRead();
  const { renewed, "no-renew": noRenew, error } = await searchParams;

  const [renewalItems, templates, canUpdate, canManageTemplates] =
    await Promise.all([
      listRenewalTrayItems(),
      listActiveContractTemplates(),
      userHasPermission(session.user.id, "contracts:update"),
      userHasPermission(session.user.id, "contract_templates:read"),
    ]);

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

        <RenewalTrayList
          canUpdate={canUpdate}
          items={renewalItems}
          templates={templates}
        />
      </div>
    </div>
  );
};

export default ContratosPage;
