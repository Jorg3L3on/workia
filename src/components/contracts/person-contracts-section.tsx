import Link from "next/link";

import { ContractForm } from "@/components/contracts/contract-form";
import { Badge } from "@/components/ui/badge";
import type { Contract, ContractTemplate } from "@/lib/db/schema";
import {
  contractNoticeWindowLabels,
  contractStatusLabels,
  contractTypeLabels,
  formatContractDate,
} from "@/lib/contracts/schema";
import { formatTimeLabel, SCHEDULE_FIELD_LABELS } from "@/lib/people/schema";

type PersonContractsSectionProps = {
  personId: string;
  personContext: {
    nombres: string;
    apellidoPaterno: string;
    apellidoMaterno?: string | null;
    puesto?: string | null;
    area?: string | null;
    sucursal?: string | null;
    rfc?: string | null;
    horario?: string | null;
  };
  contracts: Contract[];
  canCreate: boolean;
  templates: ContractTemplate[];
  showEmitForm?: boolean;
};

export const PersonContractsSection = ({
  personId,
  personContext,
  contracts,
  canCreate,
  templates,
  showEmitForm = false,
}: PersonContractsSectionProps) => {
  const vigente = contracts.find((contract) => contract.status === "vigente");

  return (
    <div className="workia-pass-card overflow-hidden">
      <div className="border-b px-5 py-4">
        <h2 className="text-base font-semibold">Contratos</h2>
        <p className="text-muted-foreground text-sm">
          Historial de contratos en el expediente — cada emisión conserva su
          texto generado.
        </p>
      </div>

      <div className="space-y-4 p-5">
        {vigente ? (
          <div className="rounded-lg border p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="text-muted-foreground font-mono text-[10px] tracking-[0.08em] uppercase">
                  Contrato vigente
                </p>
                <p className="font-medium">
                  {contractTypeLabels[vigente.type]} ·{" "}
                  {formatContractDate(vigente.startDate)}
                  {vigente.endDate
                    ? ` — ${formatContractDate(vigente.endDate)}`
                    : " · Sin fecha de fin"}
                </p>
                <p className="text-muted-foreground text-xs">
                  Plantilla: {vigente.templateName ?? "—"} · Aviso:{" "}
                  {contractNoticeWindowLabels[vigente.noticeWindow]}
                </p>
              </div>
              <Badge>{contractStatusLabels[vigente.status]}</Badge>
            </div>
            <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground">
                  {SCHEDULE_FIELD_LABELS.horarioEntrada}
                </dt>
                <dd className="font-medium">
                  {formatTimeLabel(vigente.scheduleEntrada)}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">
                  {SCHEDULE_FIELD_LABELS.horarioSalidaComer}
                </dt>
                <dd className="font-medium">
                  {formatTimeLabel(vigente.scheduleSalidaComer)}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">
                  {SCHEDULE_FIELD_LABELS.horarioRegresoComer}
                </dt>
                <dd className="font-medium">
                  {formatTimeLabel(vigente.scheduleRegresoComer)}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">
                  {SCHEDULE_FIELD_LABELS.horarioSalida}
                </dt>
                <dd className="font-medium">
                  {formatTimeLabel(vigente.scheduleSalida)}
                </dd>
              </div>
            </dl>
            <details className="mt-3">
              <summary className="cursor-pointer text-sm font-medium">
                Ver texto generado
              </summary>
              <pre className="bg-muted mt-2 max-h-48 overflow-auto rounded-lg p-3 text-xs whitespace-pre-wrap">
                {vigente.generatedText}
              </pre>
            </details>
          </div>
        ) : (
          <div className="workia-empty-state px-4 py-5 text-center">
            <p className="text-sm font-medium">Sin contrato vigente</p>
            <p className="text-muted-foreground mt-1 text-sm">
              Emite un contrato para registrar la relación laboral en el
              expediente.
            </p>
          </div>
        )}

        {canCreate && showEmitForm && !vigente && templates.length > 0 ? (
          <div className="rounded-lg border p-4">
            <h3 className="mb-3 text-sm font-semibold">Emitir contrato</h3>
            <ContractForm
              personContext={personContext}
              personId={personId}
              templates={templates}
            />
          </div>
        ) : null}

        {canCreate && showEmitForm && !vigente && templates.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No hay plantillas activas.{" "}
            <Link
              className="workia-accent-text font-medium"
              href="/app/contratos/plantillas"
            >
              Crear plantilla
            </Link>
          </p>
        ) : null}

        {contracts.length > 0 ? (
          <div className="space-y-2">
            <h3 className="text-sm font-semibold">Historial</h3>
            <ul className="divide-y rounded-lg border">
              {contracts.map((contract) => (
                <li
                  key={contract.id}
                  className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm"
                >
                  <div>
                    <p className="font-medium">
                      {contractTypeLabels[contract.type]} ·{" "}
                      {formatContractDate(contract.startDate)}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      {contract.templateName ?? "Sin plantilla"} ·{" "}
                      {contractStatusLabels[contract.status]}
                    </p>
                  </div>
                  <Badge variant="secondary">
                    {contractStatusLabels[contract.status]}
                  </Badge>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  );
};
