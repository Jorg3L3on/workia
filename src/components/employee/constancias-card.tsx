import { ChevronRightIcon, DownloadIcon } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import {
  contractStatusLabels,
  contractTypeLabels,
  formatContractDate,
} from "@/lib/contracts/schema";
import { listEmployeeContracts } from "@/lib/employee/constancias";
import { listEmployeeResguardo } from "@/lib/employee/resguardo";
import type { EmployeeContext } from "@/lib/employee-accounts/sign-in";

/**
 * "Contrato y constancias" on the employee home (W2-11): the seniority letter
 * and the current contract download from here; older contracts and the
 * resguardo are one tap away.
 */
export const ConstanciasCard = async ({
  context,
}: {
  context: EmployeeContext;
}) => {
  const [contracts, resguardo] = await Promise.all([
    listEmployeeContracts(context),
    listEmployeeResguardo(context),
  ]);
  const current =
    contracts.find((contract) => contract.status === "vigente") ?? contracts[0];
  const pending = resguardo.filter(
    (item) => item.movementId && !item.acceptedAt,
  ).length;

  return (
    <section
      aria-labelledby="mi-constancias"
      className="workia-pass-card flex flex-col gap-3 px-5 py-4"
      data-testid="employee-constancias"
    >
      <h2 className="text-base font-semibold" id="mi-constancias">
        Contrato y constancias
      </h2>

      <div className="flex flex-col gap-2">
        <Button asChild className="justify-start" size="lg" variant="secondary">
          <a download href="/mi/constancia/pdf">
            <DownloadIcon aria-hidden />
            Constancia de antigüedad
          </a>
        </Button>
        {current ? (
          <Button
            asChild
            className="justify-start"
            size="lg"
            variant="secondary"
          >
            <a download href={`/mi/contrato/${current.id}/pdf`}>
              <DownloadIcon aria-hidden />
              <span className="truncate">
                Contrato {contractTypeLabels[current.type].toLowerCase()} del{" "}
                {formatContractDate(current.startDate)} (
                {contractStatusLabels[current.status].toLowerCase()})
              </span>
            </a>
          </Button>
        ) : (
          <p className="text-muted-foreground text-sm">
            RH aún no registra tu contrato.
          </p>
        )}
      </div>

      <nav className="flex flex-col text-sm">
        {contracts.length > 1 ? (
          <Link
            className="flex min-h-11 items-center justify-between gap-2 font-medium"
            href="/mi/contrato"
          >
            Todos mis contratos ({contracts.length})
            <ChevronRightIcon aria-hidden className="size-4" />
          </Link>
        ) : null}
        <Link
          className="flex min-h-11 items-center justify-between gap-2 font-medium"
          href="/mi/resguardo"
        >
          <span>
            Mi resguardo
            {pending > 0 ? (
              <span className="text-muted-foreground font-normal">
                {" "}
                · {pending} por aceptar
              </span>
            ) : null}
          </span>
          <ChevronRightIcon aria-hidden className="size-4" />
        </Link>
      </nav>
    </section>
  );
};
