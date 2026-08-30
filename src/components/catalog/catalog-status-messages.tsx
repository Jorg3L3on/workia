type CatalogStatusMessagesProps = {
  saved?: string;
  deleted?: string;
};

export const CatalogStatusMessages = ({
  saved,
  deleted,
}: CatalogStatusMessagesProps) => {
  if (!saved && !deleted) {
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
    </>
  );
};
