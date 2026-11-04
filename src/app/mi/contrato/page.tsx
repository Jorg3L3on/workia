import { DownloadIcon } from "lucide-react";
import type { Metadata } from "next";

import { EmployeeSubpage } from "@/components/employee/employee-subpage";
import { Button } from "@/components/ui/button";
import {
  contractStatusLabels,
  contractTypeLabels,
  formatContractDate,
} from "@/lib/contracts/schema";
import { listEmployeeContracts } from "@/lib/employee/constancias";
import { requireEmployeeContext } from "@/lib/employee-accounts/session";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Contrato y constancias" };

/**
 * The employee's contracts and seniority letter (W2-11). Only the session's
 * person; every download goes through a logged PDF route.
 */
const EmployeeContractPage = async () => {
  const context = await requireEmployeeContext();
  const contracts = await listEmployeeContracts(context);

  return (
    <EmployeeSubpage
      description="Descarga tu constancia de antigüedad con fecha de hoy y cualquiera de tus contratos."
      title="Contrato y constancias"
    >
      <section
        aria-labelledby="mi-constancia"
        className="workia-pass-card flex flex-col gap-3 px-5 py-4"
      >
        <h2 className="text-base font-semibold" id="mi-constancia">
          Constancia de antigüedad
        </h2>
        <p className="text-muted-foreground text-sm">
          Dice desde cuándo trabajas aquí, tu antigüedad y tu puesto. Para un
          trámite que pida sello y firma, llévala a RH.
        </p>
        <Button asChild className="justify-start" size="lg" variant="secondary">
          <a download href="/mi/constancia/pdf">
            <DownloadIcon aria-hidden />
            Descargar constancia (PDF)
          </a>
        </Button>
      </section>

      <section
        aria-labelledby="mi-contratos"
        className="workia-pass-card flex flex-col gap-3 px-5 py-4"
      >
        <h2 className="text-base font-semibold" id="mi-contratos">
          Mis contratos
        </h2>
        {contracts.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            RH aún no registra tu contrato.
          </p>
        ) : (
          <ul className="flex flex-col divide-y">
            {contracts.map((contract) => (
              <li
                className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
                key={contract.id}
              >
                <div className="min-w-0 text-sm">
                  <p className="font-medium">
                    {contractTypeLabels[contract.type]}
                  </p>
                  <p className="text-muted-foreground">
                    {formatContractDate(contract.startDate)}
                    {contract.endDate
                      ? ` al ${formatContractDate(contract.endDate)}`
                      : ""}{" "}
                    · {contractStatusLabels[contract.status]}
                  </p>
                </div>
                <Button asChild size="lg" variant="secondary">
                  <a
                    aria-label={`Descargar contrato del ${formatContractDate(contract.startDate)}`}
                    download
                    href={`/mi/contrato/${contract.id}/pdf`}
                  >
                    <DownloadIcon aria-hidden />
                    PDF
                  </a>
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </EmployeeSubpage>
  );
};

export default EmployeeContractPage;
