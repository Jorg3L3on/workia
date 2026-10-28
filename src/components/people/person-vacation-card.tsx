import { DetailCard } from "@/components/people/person-detail-card";
import {
  VacationLedger,
  type VacationLedgerModel,
} from "@/components/people/vacation-ledger";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDateMx } from "@/lib/format/date";
import type { VacationEntitlementView } from "@/lib/people/vacation-card";
import {
  VACATION_OVER_ENTITLEMENT_WARNING,
  formatSignedVacationDays,
} from "@/lib/vacations/balance";

type PersonVacationCardProps = {
  /** "loading" is the skeleton while the expediente is still resolving. */
  view: VacationEntitlementView | "loading";
  /** Days taken, the balance and the register dialog. Omitted without a vacation permission. */
  ledger?: VacationLedgerModel & {
    takenHalves: number | null;
    remainingHalves: number | null;
    exceedsEntitlement: boolean;
  };
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

const VacationBody = ({
  view,
  ledger,
}: {
  view: VacationEntitlementView;
  ledger?: PersonVacationCardProps["ledger"];
}) => {
  const showFigures = view.serviceYearsCompleted !== null;
  const alert = view.state === "error";
  const showBalance =
    ledger?.takenHalves != null && ledger.remainingHalves != null;

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
          {showBalance && ledger ? (
            <Field
              label="Tomados"
              testId="vacation-taken"
              value={formatSignedVacationDays(ledger.takenHalves ?? 0)}
            />
          ) : null}
          {showBalance && ledger ? (
            <Field
              label="Quedan"
              testId="vacation-remaining"
              value={formatSignedVacationDays(ledger.remainingHalves ?? 0)}
            />
          ) : null}
        </dl>
      ) : null}
      {ledger?.exceedsEntitlement ? (
        <p
          className="text-sm"
          data-testid="vacation-over-warning"
          role="status"
        >
          {VACATION_OVER_ENTITLEMENT_WARNING}
        </p>
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
 * «Vacaciones» card. The entitlement stays visible with people:read. The
 * ledger (balance, history, registrar) is passed in only when the session
 * has a vacation permission.
 */
export const PersonVacationCard = ({
  view,
  ledger,
}: PersonVacationCardProps) => (
  <DetailCard id="vacaciones">
    {view === "loading" ? (
      <VacationSkeleton />
    ) : (
      <div className="space-y-3">
        <VacationBody ledger={ledger} view={view} />
        {ledger ? <VacationLedger {...ledger} /> : null}
      </div>
    )}
  </DetailCard>
);
