import Link from "next/link";

import { formatMoney } from "@/components/contracts/compensation-fields";
import { ContractForm } from "@/components/contracts/contract-form";
import { RenewalDecisionButton } from "@/components/contracts/renewal-decision-button";
import { Badge } from "@/components/ui/badge";
import type { Contract, ContractTemplate } from "@/lib/db/schema";
import {
  contractNoticeWindowLabels,
  contractStatusLabels,
  contractTypeLabels,
  formatContractDate,
  payFrequencyLabels,
  paymentMethodLabels,
  contractScheduleText,
} from "@/lib/contracts/schema";
import { toneFor } from "@/lib/ui/status-tone";

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
  /** compensation:read: shows salaries; without it only whether one was captured. */
  canSeeCompensation?: boolean;
  /** contracts:update: a fixed-term vigente contract offers «Decidir renovación». */
  canDecide?: boolean;
  personName?: string;
  positions?: { id: string; name: string }[];
};

export const PersonContractsSection = ({
  personId,
  personContext,
  contracts,
  canCreate,
  templates,
  showEmitForm = false,
  canSeeCompensation = false,
  canDecide = false,
  personName = "",
  positions = [],
}: PersonContractsSectionProps) => {
  const vigente = contracts.find((contract) => contract.status === "vigente");
  const decidable =
    canDecide && templates.length > 0 && vigente?.endDate ? vigente : null;

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-base font-semibold">Contratos</h2>
        <p className="text-muted-foreground text-sm">
          Historial de contratos en el expediente — cada emisión conserva su
          texto generado.
        </p>
      </div>

      <div className="space-y-4">
        {vigente ? (
          <div className="workia-pass-card p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="text-muted-foreground text-xs font-medium">
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
              <div className="flex items-center gap-2">
                <Badge tone={toneFor("contract", vigente.status)}>
                  {contractStatusLabels[vigente.status]}
                </Badge>
                {decidable?.endDate ? (
                  <RenewalDecisionButton
                    canSeeCompensation={canSeeCompensation}
                    compensation={
                      canSeeCompensation
                        ? {
                            salarioDiario: decidable.salarioDiario,
                            formaPago: decidable.formaPago,
                            periodicidadPago: decidable.periodicidadPago,
                            diaPago: decidable.diaPago,
                          }
                        : undefined
                    }
                    contractId={decidable.id}
                    endDate={decidable.endDate}
                    personName={personName}
                    positions={positions}
                    templates={templates}
                  />
                ) : null}
              </div>
            </div>
            <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
              <div className="sm:col-span-2">
                <dt className="text-muted-foreground">Horario al emitir</dt>
                <dd className="font-medium">{contractScheduleText(vigente)}</dd>
              </div>
              <div
                className="sm:col-span-2"
                data-testid="contract-compensation"
              >
                <dt className="text-muted-foreground">Compensación</dt>
                <dd className="font-medium">
                  {!vigente.salarioDiario
                    ? "Sin capturar"
                    : canSeeCompensation
                      ? [
                          `${formatMoney(Number(vigente.salarioDiario))} diarios`,
                          vigente.salarioMensual
                            ? `${formatMoney(Number(vigente.salarioMensual))} mensuales`
                            : null,
                          vigente.formaPago
                            ? paymentMethodLabels[vigente.formaPago]
                            : null,
                          vigente.periodicidadPago
                            ? payFrequencyLabels[vigente.periodicidadPago]
                            : null,
                          vigente.diaPago ? `paga ${vigente.diaPago}` : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")
                      : "Capturada (requiere el permiso de compensación)"}
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
          <div className="workia-pass-card p-4">
            <h3 className="mb-3 text-sm font-semibold">Emitir contrato</h3>
            <ContractForm
              canSeeCompensation={canSeeCompensation}
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
            <ul className="workia-pass-card divide-y">
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
                  <Badge tone={toneFor("contract", contract.status)}>
                    {contractStatusLabels[contract.status]}
                  </Badge>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </section>
  );
};
