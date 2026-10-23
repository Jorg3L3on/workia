import { STALE_COMPANY_MESSAGE } from "@/lib/tenant/scope";

/** Messages for the `error` codes catalog actions redirect with. */
const ERROR_MESSAGES: Record<string, string> = {
  "duplicate-name":
    "Ya existe un registro activo con ese nombre en esta empresa. Usa otro nombre.",
  "company-changed": STALE_COMPANY_MESSAGE,
  reference:
    "El área elegida ya no existe en esta empresa. Elige otra de la lista.",
  "region-not-found":
    "La región elegida no existe en esta empresa o está inactiva. Elige otra.",
  "area-cycle":
    "Un área no puede quedar debajo de sí misma ni de una de sus sub-áreas.",
  "activity-not-assignable":
    "Una de las actividades ya no está activa. Revisa las actividades del puesto.",
  "position-missing": "El puesto ya no existe en esta empresa.",
  "not-found": "El registro ya no existe en esta empresa.",
  "termination-reason-in-use":
    "Ese motivo ya se usó en una baja: desactívalo en lugar de eliminarlo.",
  "termination-reason-classification":
    "Elige si el motivo es voluntario, involuntario u otro.",
  "termination-reasons-forbidden":
    "No tienes permiso para editar los motivos de baja.",
};

type CatalogStatusMessagesProps = {
  error?: string;
  saved?: string;
  deleted?: string;
};

export const CatalogStatusMessages = ({
  error,
  saved,
  deleted,
}: CatalogStatusMessagesProps) => {
  const errorMessage = error ? ERROR_MESSAGES[error] : undefined;

  if (!saved && !deleted && !errorMessage) {
    return null;
  }

  return (
    <>
      {errorMessage ? (
        <p className="text-destructive text-sm font-medium" role="alert">
          {errorMessage}
        </p>
      ) : null}
      {saved ? (
        <p
          className="text-sm font-medium text-[color:var(--workia-accent-blue)]"
          role="status"
        >
          Cambios guardados.
        </p>
      ) : null}
      {deleted ? (
        <p
          className="text-sm font-medium text-[color:var(--workia-accent-blue)]"
          role="status"
        >
          Registro eliminado.
        </p>
      ) : null}
    </>
  );
};
