import type { ReactNode } from "react";

import { DetailCard } from "@/components/people/person-detail-card";

export type PersonBajaDetail = { label: string; value: ReactNode };

type PersonBajaCardProps = {
  status: "activa" | "baja";
  /**
   * The baja as label/value rows (fecha, tipo, motivo, recontratable,
   * finiquito, periodos). The baja model is iniciativa 2's: until it lands
   * there are none and the card says so.
   */
  details?: PersonBajaDetail[];
  /** «Reingresar», from iniciativa 2. */
  action?: ReactNode;
};

/**
 * The slot for the baja block. Renders nothing for an active person; for a
 * person on baja it shows the details it is given, or a placeholder.
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
        <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          {details.map((detail) => (
            <div className="min-w-0" key={detail.label}>
              <dt className="workia-field-label">{detail.label}</dt>
              <dd className="font-medium break-words">{detail.value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="text-muted-foreground text-sm" data-testid="baja-empty">
          Esta persona está dada de baja. La fecha, el tipo, el motivo y si es
          recontratable todavía no se registran en Workia.
        </p>
      )}
      {action ? <div className="mt-4">{action}</div> : null}
    </DetailCard>
  );
};
