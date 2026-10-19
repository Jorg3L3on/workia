import type { Metadata } from "next";
import Link from "next/link";

import { ImportUndoButton } from "@/components/import/import-undo-button";
import { ListPageHeader } from "@/components/list/list-page-header";
import { Button } from "@/components/ui/button";
import { pageTitles } from "@/lib/brand/chrome-copy";
import { isUndoWindowOpen } from "@/lib/import/undo-window";
import { formatDateTimeMx } from "@/lib/format/date";
import { listImportJobs } from "@/lib/import/jobs";
import { requirePeopleImport } from "@/lib/people/auth";
import { userHasPermission } from "@/lib/rbac";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: pageTitles.importaciones,
};

const STATUS_LABELS = {
  uploading: "Subiendo",
  validating: "Validando",
  in_review: "En revisión",
  applying: "Aplicando",
  applied: "Aplicada",
  failed: "Pausada o con error",
  undone: "Deshecha",
} as const;

const RESUMABLE = ["validating", "in_review", "applying", "failed"];

const ImportacionesPage = async () => {
  const session = await requirePeopleImport();
  const [jobs, canUndo] = await Promise.all([
    listImportJobs(session.companyId),
    userHasPermission(session.user.id, "people:delete"),
  ]);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <ListPageHeader
        actions={
          <Button asChild>
            <Link href="/app/personas/importar">Nueva importación</Link>
          </Button>
        }
        description="Cada importación queda registrada: quién la hizo, qué cambió y si se puede deshacer."
        title="Historial de importaciones"
      />

      {jobs.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          Todavía no hay importaciones.
        </p>
      ) : (
        <div className="bg-card ring-foreground/10 overflow-x-auto rounded-lg ring-1">
          <table className="w-full text-sm">
            <caption className="sr-only">Importaciones de personas</caption>
            <thead>
              <tr className="text-muted-foreground border-b text-left">
                <th className="px-3 py-2 font-medium" scope="col">
                  Archivo
                </th>
                <th className="px-3 py-2 font-medium" scope="col">
                  Fecha
                </th>
                <th className="px-3 py-2 font-medium" scope="col">
                  Hecha por
                </th>
                <th className="px-3 py-2 font-medium" scope="col">
                  Estado
                </th>
                <th className="px-3 py-2 font-medium" scope="col">
                  Filas
                </th>
                <th className="px-3 py-2 font-medium" scope="col">
                  Acciones
                </th>
              </tr>
            </thead>
            <tbody>
              {jobs.map(({ job, actorName, actorEmail }) => {
                const errors = job.counts.error ?? 0;
                const undoable =
                  canUndo &&
                  job.status === "applied" &&
                  isUndoWindowOpen(job.appliedAt);

                return (
                  <tr className="border-b align-top last:border-0" key={job.id}>
                    <td className="px-3 py-2 font-medium">{job.fileName}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {formatDateTimeMx(job.createdAt)}
                    </td>
                    <td className="px-3 py-2">
                      {actorName ?? actorEmail ?? "—"}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {STATUS_LABELS[job.status]}
                    </td>
                    <td className="px-3 py-2">
                      {(job.counts.total ?? 0).toLocaleString("es-MX")} filas
                      <span className="text-muted-foreground block text-xs">
                        {(job.counts.create ?? 0).toLocaleString("es-MX")}{" "}
                        nuevas ·{" "}
                        {(job.counts.update ?? 0).toLocaleString("es-MX")}{" "}
                        actualizadas · {errors.toLocaleString("es-MX")} con
                        errores
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-2">
                        {RESUMABLE.includes(job.status) ? (
                          <Button asChild size="sm" variant="secondary">
                            <Link href={`/app/personas/importar?job=${job.id}`}>
                              Continuar
                            </Link>
                          </Button>
                        ) : null}
                        {errors > 0 && job.status !== "uploading" ? (
                          <Button asChild size="sm" variant="secondary">
                            <a
                              download
                              href={`/api/import/personas/${job.id}/errors`}
                            >
                              Descargar errores
                            </a>
                          </Button>
                        ) : null}
                        {undoable ? (
                          <ImportUndoButton
                            fileName={job.fileName}
                            jobId={job.id}
                          />
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default ImportacionesPage;
