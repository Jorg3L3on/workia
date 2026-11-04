import { formatDateMx, formatDateTimeMx } from "@/lib/format/date";
import {
  TIME_OFF_KIND_LABELS,
  WEEK_DAY_LABELS,
  type RequestDetail,
} from "@/lib/requests";
import { formatVacationDays } from "@/lib/vacations/balance";

import { RequestStatusBadge } from "./request-status-badge";

const range = (startDate: string, endDate: string) =>
  startDate === endDate
    ? formatDateMx(startDate)
    : `${formatDateMx(startDate)} al ${formatDateMx(endDate)}`;

/**
 * One request and what the approver weighs before deciding (W2-06): the
 * days against the person's schedule and who else on the team is off.
 * Shared by the manager's screen in /mi and HR's in /app.
 */
export const RequestDetails = ({ request }: { request: RequestDetail }) => {
  const { conflicts } = request;
  const requested = Number(request.days);
  const facts = [
    { label: "Persona", value: request.personName },
    { label: "Qué pide", value: TIME_OFF_KIND_LABELS[request.kind] },
    { label: "Fechas", value: range(request.startDate, request.endDate) },
    { label: "Días", value: formatVacationDays(request.days) },
    { label: "Enviada", value: formatDateTimeMx(request.createdAt) },
    { label: "Decide", value: request.approverName ?? "RH" },
    { label: "Nota", value: request.note },
    {
      label: "Decidió",
      value: request.decidedByName
        ? `${request.decidedByName}${request.decidedAt ? `, ${formatDateTimeMx(request.decidedAt)}` : ""}`
        : null,
    },
    { label: "Motivo", value: request.decisionReason },
  ].filter((fact) => fact.value);

  return (
    <div className="space-y-4">
      <section className="workia-pass-card space-y-3 px-5 py-4">
        <RequestStatusBadge status={request.status} />
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          {facts.map((fact) => (
            <div className="min-w-0" key={fact.label}>
              <dt className="workia-field-label">{fact.label}</dt>
              <dd className="font-medium break-words">{fact.value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section
        aria-labelledby="request-conflicts"
        className="workia-pass-card space-y-2 px-5 py-4"
        data-testid="request-conflicts"
      >
        <h2 className="text-base font-semibold" id="request-conflicts">
          Antes de decidir
        </h2>
        <p className="text-sm">
          {conflicts.restDay
            ? `Su día de descanso es el ${WEEK_DAY_LABELS[conflicts.restDay]}: el periodo tiene ${conflicts.workingDays} ${conflicts.workingDays === 1 ? "día" : "días"} de trabajo.`
            : `RH no tiene capturado su día de descanso: el periodo tiene ${conflicts.workingDays} ${conflicts.workingDays === 1 ? "día" : "días"} de calendario.`}
          {requested > conflicts.workingDays
            ? " Pide más días de los que trabaja en esas fechas."
            : null}
        </p>
        {conflicts.teamOverlaps.length > 0 ? (
          <>
            <p className="text-sm font-medium">
              También faltan del equipo en esas fechas:
            </p>
            <ul className="text-muted-foreground space-y-1 text-sm">
              {conflicts.teamOverlaps.map((overlap, index) => (
                <li key={`${overlap.personName}-${overlap.startDate}-${index}`}>
                  {overlap.personName}:{" "}
                  {range(overlap.startDate, overlap.endDate)} ({overlap.what})
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="text-muted-foreground text-sm">
            Nadie más del equipo falta en esas fechas.
          </p>
        )}
      </section>
    </div>
  );
};
