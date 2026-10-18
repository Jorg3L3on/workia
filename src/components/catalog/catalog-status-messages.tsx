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
};

type CatalogStatusMessagesProps = {
  error?: string;
  saved?: string;
  deleted?: string;
  assigned?: string;
  unassigned?: string;
};

export const CatalogStatusMessages = ({
  error,
  saved,
  deleted,
  assigned,
  unassigned,
}: CatalogStatusMessagesProps) => {
  const errorMessage = error ? ERROR_MESSAGES[error] : undefined;

  if (!saved && !deleted && !assigned && !unassigned && !errorMessage) {
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
          Registro borrado lógicamente.
        </p>
      ) : null}
      {assigned ? (
        <p
          className="text-sm font-medium text-[color:var(--workia-accent-blue)]"
          role="status"
        >
          Actividad asignada al puesto.
        </p>
      ) : null}
      {unassigned ? (
        <p
          className="text-sm font-medium text-[color:var(--workia-accent-blue)]"
          role="status"
        >
          Actividad quitada del puesto.
        </p>
      ) : null}
    </>
  );
};
