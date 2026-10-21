import type { ReactNode } from "react";

import { DetailCard } from "@/components/people/person-detail-card";
import { cn } from "@/lib/utils";

export type PersonBajaDetail = {
  label: string;
  value: ReactNode;
  /** A muted line under the value («inferida», what to review). */
  hint?: string;
  /** Spans the whole row (the comentario). */
  wide?: boolean;
  testId?: string;
};

type PersonBajaCardProps = {
  status: "activa" | "baja";
  /**
   * The baja as label/value rows (bajaDetails(): fecha, tipo, motivo,
   * recontratable, finiquito, comentario). The card does no masking: the
   * finiquito amount comes in already masked without compensation:read.
   */
  details?: PersonBajaDetail[];
  /** «Reingresar» (people:update). */
  action?: ReactNode;
};

/**
 * The baja block. Renders nothing for an active person; for a person on baja
 * it shows the details it is given, or a placeholder when the baja has no
 * employment period to read them from.
 */
export const PersonBajaCard = ({
  status,
  details = [],
  action,
}: PersonBajaCardProps) => {
  if (status !== "baja") {
    return null;
  }

  return (
    <DetailCard id="baja" title="Baja">
      {details.length > 0 ? (
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm lg:grid-cols-3 xl:grid-cols-6">
          {details.map((detail) => (
            <div
              className={cn(
                "min-w-0",
                detail.wide && "col-span-2 lg:col-span-3 xl:col-span-6",
              )}
              data-testid={detail.testId}
              key={detail.label}
            >
              <dt className="workia-field-label">{detail.label}</dt>
              <dd className="font-medium break-words">{detail.value}</dd>
              {detail.hint ? (
                <dd className="text-muted-foreground text-xs">{detail.hint}</dd>
              ) : null}
            </div>
          ))}
        </dl>
      ) : (
        <p className="text-muted-foreground text-sm" data-testid="baja-empty">
          Esta persona está dada de baja, pero no tiene un periodo laboral
          registrado: la fecha, el tipo y el motivo no se capturaron.
        </p>
      )}
      {action ? <div className="mt-4">{action}</div> : null}
    </DetailCard>
  );
};
