import { CheckIcon } from "lucide-react";
import type { Metadata } from "next";

import { EmployeeSubpage } from "@/components/employee/employee-subpage";
import { ResguardoAccept } from "@/components/employee/resguardo-accept";
import { formatContractDate } from "@/lib/contracts/schema";
import { listEmployeeResguardo } from "@/lib/employee/resguardo";
import { requireEmployeeContext } from "@/lib/employee-accounts/session";
import { formatDateTimeMx } from "@/lib/format/date";
import { assetCategoryLabels } from "@/lib/resguardo/schema";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Mi resguardo" };

/**
 * What the company lent the employee (W2-11), and the acceptance of each
 * entrega from the phone. Only the session's person.
 */
const EmployeeResguardoPage = async () => {
  const context = await requireEmployeeContext();
  const items = await listEmployeeResguardo(context);

  return (
    <EmployeeSubpage
      description="Lo que la empresa te entregó y está a tu nombre. Revisa cada cosa y acepta que la recibiste en ese estado."
      title="Mi resguardo"
    >
      {items.length === 0 ? (
        <section className="workia-pass-card px-5 py-4">
          <p className="text-muted-foreground text-sm">
            No tienes nada en resguardo.
          </p>
        </section>
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((item) => (
            <li
              className="workia-pass-card flex flex-col gap-3 px-5 py-4"
              data-testid="employee-resguardo-item"
              key={item.assetId}
            >
              <div className="space-y-0.5">
                <h2 className="text-base font-semibold">{item.name}</h2>
                <p className="text-muted-foreground text-sm">
                  {assetCategoryLabels[item.category] ?? item.category} ·{" "}
                  {item.identifier}
                </p>
              </div>
              <dl className="grid gap-3 text-sm sm:grid-cols-2">
                {item.deliveredOn ? (
                  <div>
                    <dt className="workia-field-label">Entregado el</dt>
                    <dd className="font-medium">
                      {formatContractDate(item.deliveredOn)}
                    </dd>
                  </div>
                ) : null}
                {item.deliveryNote || item.conditionNote ? (
                  <div className="min-w-0">
                    <dt className="workia-field-label">Estado al entregar</dt>
                    <dd className="font-medium break-words">
                      {item.deliveryNote ?? item.conditionNote}
                    </dd>
                  </div>
                ) : null}
              </dl>
              {item.acceptedAt ? (
                <p className="flex items-center gap-1.5 text-sm font-medium">
                  <CheckIcon aria-hidden className="size-4" />
                  Aceptado el {formatDateTimeMx(item.acceptedAt)}
                </p>
              ) : item.movementId ? (
                <ResguardoAccept
                  assetName={item.name}
                  movementId={item.movementId}
                />
              ) : (
                <p className="text-muted-foreground text-sm">
                  Sin entrega registrada; RH la captura.
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </EmployeeSubpage>
  );
};

export default EmployeeResguardoPage;
