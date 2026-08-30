type CatalogStatusMessagesProps = {
  saved?: string;
  deleted?: string;
  assigned?: string;
  unassigned?: string;
};

export const CatalogStatusMessages = ({
  saved,
  deleted,
  assigned,
  unassigned,
}: CatalogStatusMessagesProps) => {
  if (!saved && !deleted && !assigned && !unassigned) {
    return null;
  }

  return (
    <>
      {saved ? (
        <p
          className="text-sm font-medium text-[color:var(--workia-accent-violet)]"
          role="status"
        >
          Cambios guardados.
        </p>
      ) : null}
      {deleted ? (
        <p
          className="text-sm font-medium text-[color:var(--workia-accent-violet)]"
          role="status"
        >
          Registro borrado lógicamente.
        </p>
      ) : null}
      {assigned ? (
        <p
          className="text-sm font-medium text-[color:var(--workia-accent-violet)]"
          role="status"
        >
          Actividad asignada al puesto.
        </p>
      ) : null}
      {unassigned ? (
        <p
          className="text-sm font-medium text-[color:var(--workia-accent-violet)]"
          role="status"
        >
          Actividad quitada del puesto.
        </p>
      ) : null}
    </>
  );
};
