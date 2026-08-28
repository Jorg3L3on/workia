import Link from "next/link";
import { FileTextIcon } from "lucide-react";

import { RenewalTrayList } from "@/components/contracts/person-contracts-section";
import {
  ListResultCount,
  ListTableShell,
} from "@/components/list/list-table-shell";
import { Button } from "@/components/ui/button";
import {
  listActiveContractTemplates,
  listRenewalTrayItems,
} from "@/lib/contracts";
import { requireContractsRead } from "@/lib/contracts/auth";
import { userHasPermission } from "@/lib/rbac";

export const dynamic = "force-dynamic";

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
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <p className="text-muted-foreground font-mono text-[10.5px] font-medium tracking-[0.09em] uppercase">
            Expediente
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">Contratos</h1>
          <p className="text-muted-foreground text-sm">
            Bandeja de renovaciones según la ventana de aviso de cada contrato.
          </p>
        </div>
        {canManageTemplates ? (
          <Button asChild variant="outline">
            <Link href="/app/contratos/plantillas">
              <FileTextIcon className="size-4" aria-hidden />
              Plantillas
            </Link>
          </Button>
        ) : null}
      </header>

      {renewed === "1" ? (
        <p
          className="text-sm font-medium text-[color:var(--workia-accent-violet)]"
          role="status"
        >
          Contrato renovado correctamente.
        </p>
      ) : null}

      {noRenew === "1" ? (
        <p
          className="text-sm font-medium text-[color:var(--workia-accent-violet)]"
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

      <div className="space-y-2">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold">Renovaciones pendientes</h2>
            <p className="text-muted-foreground text-sm">
              Contratos en ventana de aviso
            </p>
          </div>
          <ListResultCount
            count={renewalItems.length}
            plural="contratos"
            singular="contrato"
          />
        </div>

        <ListTableShell>
          <RenewalTrayList
            canUpdate={canUpdate}
            items={renewalItems}
            templates={templates}
          />
        </ListTableShell>
      </div>
    </div>
  );
};

export default ContratosPage;
