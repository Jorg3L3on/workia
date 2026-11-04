import Link from "next/link";

import { formatDateMx } from "@/lib/format/date";
import {
  VACATION_COPY,
  VACATION_OVER_ENTITLEMENT_WARNING,
  formatSignedVacationDays,
  formatVacationDays,
} from "@/lib/vacations/balance";
import type {
  VacationBalanceSummary,
  VacationYearLine,
} from "@/lib/vacations/summary";

/**
 * «Mis vacaciones» for the employee app (W2-05). Read-only, phone first.
 * It renders the same VacationBalanceSummary as the HR card, so the numbers
 * match. Days only: no prima vacacional line and no amounts. Ledger notes
 * and authors are not part of the summary.
 */

export const EMPLOYEE_VACATION_COPY = {
  title: "Mis vacaciones",
  remaining: "Te quedan",
  entitlement: "Días de derecho",
  taken: "Tomados",
  grantBy: "Se otorgan antes del",
  nextAnniversary: "Siguiente aniversario",
  years: "Por año de servicio",
  history: "Días tomados",
  constancia: "Constancia",
  serviceYear: (year: number) => `Año ${year}`,
  noEntitlement: "Sin cálculo",
} as const;

type EmployeeVacationBalanceProps = {
  summary: VacationBalanceSummary;
  /**
   * Link to the printable constancia of a service year. Omitted (or null for
   * a year) when the app has no constancia route for the employee yet.
   */
  constanciaHref?: (serviceYear: number) => string | null;
};

const dayLabel = (days: number) =>
  `${days.toLocaleString("es-MX")} ${days === 1 ? "día" : "días"}`;

const Figure = ({
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

const YearRow = ({
  line,
  href,
}: {
  line: VacationYearLine;
  href: string | null;
}) => (
  <li
    className="flex items-start justify-between gap-3 py-2 text-sm"
    data-current={line.current ? "true" : undefined}
    data-testid={`vacation-year-${line.serviceYear}`}
  >
    <div className="min-w-0">
      <p className="font-medium">
        {EMPLOYEE_VACATION_COPY.serviceYear(line.serviceYear)}
      </p>
      <p className="text-muted-foreground">
        {line.entitlementDays === null
          ? EMPLOYEE_VACATION_COPY.noEntitlement
          : `${dayLabel(line.entitlementDays)} · ${EMPLOYEE_VACATION_COPY.taken.toLowerCase()} ${formatSignedVacationDays(line.takenHalves)}`}
      </p>
    </div>
    <div className="flex shrink-0 flex-col items-end gap-1">
      {line.remainingHalves !== null ? (
        <span className="font-medium" data-testid="vacation-year-remaining">
          {formatSignedVacationDays(line.remainingHalves)}
        </span>
      ) : null}
      {href ? (
        <Link className="text-primary text-xs underline" href={href}>
          {EMPLOYEE_VACATION_COPY.constancia}
        </Link>
      ) : null}
    </div>
  </li>
);

export const EmployeeVacationBalance = ({
  summary,
  constanciaHref,
}: EmployeeVacationBalanceProps) => {
  const { view, current, years, records } = summary;
  const hrefFor = (line: VacationYearLine) =>
    line.constancia && constanciaHref ? constanciaHref(line.serviceYear) : null;

  return (
    <section
      aria-labelledby="mis-vacaciones-titulo"
      className="workia-pass-card space-y-4 px-5 py-4"
      data-state={view.state}
    >
      <h2
        className="text-base font-semibold tracking-tight"
        id="mis-vacaciones-titulo"
      >
        {EMPLOYEE_VACATION_COPY.title}
      </h2>

      {view.message ? (
        <p
          className="text-sm"
          data-testid="vacation-message"
          role={view.state === "error" ? "alert" : "status"}
        >
          {view.message}
        </p>
      ) : null}

      {current ? (
        <div className="space-y-3">
          <p data-testid="vacation-remaining">
            <span className="text-muted-foreground block text-sm">
              {EMPLOYEE_VACATION_COPY.remaining}
            </span>
            <span className="text-3xl font-semibold tracking-tight">
              {formatSignedVacationDays(current.remainingHalves)}
            </span>
          </p>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
            <Figure
              label={EMPLOYEE_VACATION_COPY.entitlement}
              testId="vacation-days"
              value={dayLabel(current.entitlementDays)}
            />
            <Figure
              label={EMPLOYEE_VACATION_COPY.taken}
              testId="vacation-taken"
              value={formatSignedVacationDays(current.takenHalves)}
            />
            {view.grantBy ? (
              <Figure
                label={EMPLOYEE_VACATION_COPY.grantBy}
                testId="vacation-grant-by"
                value={formatDateMx(view.grantBy)}
              />
            ) : null}
            {view.nextAnniversary && !view.closed ? (
              <Figure
                label={EMPLOYEE_VACATION_COPY.nextAnniversary}
                value={formatDateMx(view.nextAnniversary)}
              />
            ) : null}
          </dl>
          {current.exceedsEntitlement ? (
            <p
              className="text-sm"
              data-testid="vacation-over-warning"
              role="status"
            >
              {VACATION_OVER_ENTITLEMENT_WARNING}
            </p>
          ) : null}
        </div>
      ) : null}

      {years.length > 0 ? (
        <div>
          <h3 className="workia-field-label">{EMPLOYEE_VACATION_COPY.years}</h3>
          <ul className="divide-y" data-testid="vacation-years">
            {years.map((line) => (
              <YearRow
                href={hrefFor(line)}
                key={line.serviceYear}
                line={line}
              />
            ))}
          </ul>
        </div>
      ) : null}

      <div>
        <h3 className="workia-field-label">{EMPLOYEE_VACATION_COPY.history}</h3>
        {records.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            {VACATION_COPY.emptyHistory}
          </p>
        ) : (
          <ul className="divide-y" data-testid="vacation-history">
            {records.map((record) => (
              <li
                className="flex items-center justify-between gap-3 py-2 text-sm"
                key={record.id}
              >
                <span>
                  {formatDateMx(record.startDate)} –{" "}
                  {formatDateMx(record.endDate)}
                </span>
                <span className="font-medium">
                  {formatVacationDays(record.days)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
};
