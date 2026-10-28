import { DetailCard } from "@/components/people/person-detail-card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDateMx } from "@/lib/format/date";
import type { VacationEntitlementView } from "@/lib/people/vacation-card";

type PersonVacationCardProps = {
  /** "loading" is the skeleton while the expediente is still resolving. */
  view: VacationEntitlementView | "loading";
};

const dayLabel = (days: number) =>
  `${days.toLocaleString("es-MX")} ${days === 1 ? "día" : "días"}`;

const Field = ({
  label,
  value,
  testId,
}: {
  label: string;
  value: string;
  testId?: string;
}) => (
  <div className="min-w-0" data-testid={testId}>
    <dt className="workia-field-label">{label}</dt>
    <dd className="font-medium break-words">{value}</dd>
  </div>
);

const VacationSkeleton = () => (
  <div
    aria-busy="true"
    aria-label="Cargando vacaciones"
    className="space-y-3"
    data-testid="vacation-skeleton"
    role="status"
  >
    <Skeleton className="h-4 w-48" />
    <Skeleton className="h-4 w-full" />
    <Skeleton className="h-4 w-2/3" />
  </div>
);

const VacationBody = ({ view }: { view: VacationEntitlementView }) => {
  const showFigures = view.serviceYearsCompleted !== null;
  const alert = view.state === "error";

  return (
    <div className="space-y-3" data-state={view.state}>
      {view.message ? (
        <p
          className="text-sm"
          data-testid="vacation-message"
          role={alert ? "alert" : "status"}
        >
          {view.message}
        </p>
      ) : null}
      {showFigures ? (
        <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
          <Field
            label="Año de servicio cumplido"
            testId="vacation-service-year"
            value={String(view.serviceYearsCompleted)}
          />
          <Field
            label="Aniversario actual"
            value={formatDateMx(view.currentAnniversary)}
          />
          <Field
            label="Siguiente aniversario"
            value={formatDateMx(view.nextAnniversary)}
          />
          {view.entitlementDays !== null ? (
            <Field
              label="Días de derecho"
              testId="vacation-days"
              value={dayLabel(view.entitlementDays)}
            />
          ) : null}
          {view.grantBy ? (
            <Field
              label="Otorgar antes del"
              testId="vacation-grant-by"
              value={formatDateMx(view.grantBy)}
            />
          ) : null}
        </dl>
      ) : null}
      {view.prima ? (
        <p
          className="text-muted-foreground text-sm"
          data-testid="vacation-prima"
        >
          {view.prima}
        </p>
      ) : null}
    </div>
  );
};

/**
 * Read-only «Vacaciones» card (WRK-I14-2). Visible with people:read, the
 * same gate as the expediente. No edit action: days taken and the balance
 * are a later phase.
 */
export const PersonVacationCard = ({ view }: PersonVacationCardProps) => (
  <DetailCard id="vacaciones">
    {view === "loading" ? <VacationSkeleton /> : <VacationBody view={view} />}
  </DetailCard>
);
