import type { PersonEventType } from "@/lib/db/schema";
import { terminationTypeLabels } from "@/lib/people/employment-schema";

/**
 * The group timeline in words (W2-24): one line per person_events row. Pure
 * and client-safe. Payloads hold ids and kinds only (docs/timeline.md), so a
 * company is named from `companyNames`; one the reader may not see stays
 * «otra empresa del grupo».
 */

const OTHER_COMPANY = "otra empresa del grupo";

const text = (value: unknown) => (typeof value === "string" ? value : null);

const typeLabels: Record<PersonEventType, string> = {
  attendance: "Asistencia",
  incidencia: "Incidencia",
  vacation: "Vacaciones",
  receipt: "Recibo de nómina",
  document: "Documento",
  employment: "Laboral",
};

const vacationLabels: Record<string, string> = {
  enjoyment: "Vacaciones disfrutadas",
  void: "Registro de vacaciones anulado",
  request: "Solicitud de vacaciones",
  approval: "Vacaciones aprobadas",
  rejection: "Vacaciones rechazadas",
};

const documentLabels: Record<string, string> = {
  uploaded: "Documento cargado",
  accepted: "Documento entregado",
  rejected: "Documento rechazado",
  expired: "Documento vencido",
};

const incidenciaLabels: Record<string, string> = {
  falta: "Falta",
  retardo: "Retardo",
  salida_anticipada: "Salida anticipada",
};

const plural = (count: number, one: string, many: string) =>
  `${count} ${count === 1 ? one : many}`;

export const describeGroupEvent = (
  event: { type: PersonEventType; payload: Record<string, unknown> },
  companyNames: ReadonlyMap<string, string>,
): string => {
  const { payload } = event;
  const kind = text(payload.kind);
  const company = (id: unknown) =>
    (typeof id === "string" && companyNames.get(id)) || OTHER_COMPANY;

  switch (event.type) {
    case "employment": {
      if (kind === "alta") return "Ingreso";
      if (kind === "cambio") return "Cambio de puesto, sucursal, área o jefe";
      if (kind === "baja") {
        const tipo = text(payload.tipo);
        const label =
          tipo && tipo in terminationTypeLabels
            ? terminationTypeLabels[tipo as keyof typeof terminationTypeLabels]
            : null;

        return label ? `Baja · ${label}` : "Baja";
      }
      if (kind === "transfer") {
        return payload.direction === "in"
          ? `Llega por traslado desde ${company(payload.from_company_id)}`
          : `Se traslada a ${company(payload.to_company_id)}`;
      }
      return typeLabels.employment;
    }
    case "vacation": {
      const label = (kind && vacationLabels[kind]) || typeLabels.vacation;
      const days = Number(payload.days);

      return Number.isFinite(days) && days > 0
        ? `${label} · ${plural(days, "día", "días")}`
        : label;
    }
    case "document": {
      const status = text(payload.status);
      return (status && documentLabels[status]) || typeLabels.document;
    }
    case "incidencia":
      return (kind && incidenciaLabels[kind]) || typeLabels.incidencia;
    case "attendance": {
      const punches = Array.isArray(payload.punches)
        ? payload.punches.length
        : Number(payload.punches);

      return Number.isFinite(punches) && punches > 0
        ? `Asistencia · ${plural(punches, "checada", "checadas")}`
        : typeLabels.attendance;
    }
    default:
      return typeLabels[event.type] ?? event.type;
  }
};
