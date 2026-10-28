import { PrintButton } from "@/components/people/print-button";
import { formatDateMx } from "@/lib/format/date";
import {
  formatSignedVacationDays,
  formatVacationDays,
} from "@/lib/vacations/balance";
import type { VacationConstancia } from "@/lib/vacations/constancia-sheet";

type VacationConstanciaDocumentProps = {
  constancia: VacationConstancia;
};

const Field = ({
  label,
  testId,
  value,
}: {
  label: string;
  testId: string;
  value: string;
}) => (
  <div className="min-w-0" data-testid={testId}>
    <dt className="workia-field-label">{label}</dt>
    <dd className="font-medium">{value}</dd>
  </div>
);

/**
 * Printable annual vacation constancia. The print button and the app shell
 * stay off the sheet (`print:hidden` and the print rules in globals.css).
 * Wording stays to the figures: no article text is rendered here.
 */
export const VacationConstanciaDocument = ({
  constancia,
}: VacationConstanciaDocumentProps) => {
  const takenLabel = formatSignedVacationDays(constancia.takenHalves);
  const entitlementLabel = formatSignedVacationDays(
    constancia.entitlementDays * 2,
  );

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 print:max-w-none print:gap-0">
      <div className="flex justify-end print:hidden" data-print-hide>
        <PrintButton />
      </div>

      <article
        aria-label="Constancia de vacaciones"
        className="vacation-constancia workia-pass-card break-inside-avoid space-y-5 p-8 print:border-0 print:bg-white print:p-0 print:shadow-none"
        data-testid="vacation-constancia"
      >
        <header className="space-y-1 text-center">
          <p
            className="text-muted-foreground text-xs tracking-widest uppercase"
            data-testid="vacation-constancia-company"
          >
            {constancia.companyName}
          </p>
          <h1 className="text-xl font-semibold">Constancia de vacaciones</h1>
        </header>

        <p className="leading-relaxed">
          {constancia.companyName} hace constar que{" "}
          <strong data-testid="vacation-constancia-person">
            {constancia.personName}
          </strong>{" "}
          tiene los siguientes datos de vacaciones.
        </p>

        <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
          <Field
            label="Fecha de antigüedad"
            testId="vacation-constancia-seniority"
            value={formatDateMx(constancia.seniorityDate)}
          />
          <Field
            label="Año de servicio"
            testId="vacation-constancia-year"
            value={String(constancia.serviceYear)}
          />
          <Field
            label="Días de derecho"
            testId="vacation-constancia-entitlement"
            value={entitlementLabel}
          />
          <Field
            label="Días tomados"
            testId="vacation-constancia-taken"
            value={takenLabel}
          />
          <Field
            label="Otorgar antes del"
            testId="vacation-constancia-grant-by"
            value={formatDateMx(constancia.grantBy)}
          />
        </dl>

        {constancia.ranges.length > 0 ? (
          <ul className="text-sm" data-testid="vacation-constancia-ranges">
            {constancia.ranges.map((range) => (
              <li key={`${range.startDate}-${range.endDate}-${range.days}`}>
                {formatDateMx(range.startDate)} al {formatDateMx(range.endDate)}{" "}
                · {formatVacationDays(range.days)}
              </li>
            ))}
          </ul>
        ) : null}

        <p
          className="text-muted-foreground text-sm"
          data-testid="vacation-constancia-issued"
        >
          Se extiende la presente el {formatDateMx(constancia.issuedOn)}.
        </p>

        <div
          className="grid grid-cols-2 gap-10 pt-12"
          data-testid="vacation-constancia-signatures"
        >
          <div className="border-t pt-2 text-center text-xs">
            Nombre y firma de quien expide
          </div>
          <div className="border-t pt-2 text-center text-xs">
            Firma de la persona trabajadora
          </div>
        </div>
      </article>
    </div>
  );
};
