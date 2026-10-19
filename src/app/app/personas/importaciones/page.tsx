import type { Metadata } from "next";
import { UploadIcon } from "lucide-react";

import { ImportacionesDataTable } from "@/components/import/importaciones-data-table";
import { PageHeader } from "@/components/layout/page-header";
import { pageTitles } from "@/lib/brand/chrome-copy";
import { isUndoWindowOpen } from "@/lib/import/undo-window";
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
      <PageHeader
        description="Quién importó, qué cambió y si se puede deshacer."
        primary={{
          label: "Nueva importación",
          icon: UploadIcon,
          href: "/app/personas/importar",
        }}
        title="Historial de importaciones"
      />

      <ImportacionesDataTable
        jobs={jobs.map(({ job, actorName, actorEmail }) => {
          const errors = job.counts.error ?? 0;

          return {
            id: job.id,
            fileName: job.fileName,
            createdAt: job.createdAt,
            actor: actorName ?? actorEmail ?? null,
            status: job.status,
            statusLabel: STATUS_LABELS[job.status],
            total: job.counts.total ?? 0,
            created: job.counts.create ?? 0,
            updated: job.counts.update ?? 0,
            errors,
            resumable: RESUMABLE.includes(job.status),
            hasErrorsFile: errors > 0 && job.status !== "uploading",
            undoable:
              canUndo &&
              job.status === "applied" &&
              isUndoWindowOpen(job.appliedAt),
          };
        })}
      />
    </div>
  );
};

export default ImportacionesPage;
