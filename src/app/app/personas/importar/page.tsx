import type { Metadata } from "next";

import { ImportWizard } from "@/components/import/import-wizard";
import { ListPageHeader } from "@/components/list/list-page-header";
import { pageTitles } from "@/lib/brand/chrome-copy";
import { getImportJob } from "@/lib/import/jobs";
import { isUuid } from "@/lib/import/person-rows";
import { requirePeopleImport } from "@/lib/people/auth";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: pageTitles.importarPersonas,
};

type Props = { searchParams: Promise<{ job?: string }> };

const ImportarPersonasPage = async ({ searchParams }: Props) => {
  const session = await requirePeopleImport();

  const { job: jobId } = await searchParams;
  const job =
    jobId && isUuid(jobId)
      ? await getImportJob(session.companyId, jobId)
      : null;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <ListPageHeader
        description="Carga personas, horarios y contratos desde un archivo, con revisión antes de aplicar."
        title="Importar personas"
      />
      <ImportWizard
        initialJob={
          job
            ? {
                id: job.id,
                status: job.status,
                fileName: job.fileName,
                counts: job.counts,
                options: job.options,
                failureMessage: job.failureMessage,
                createdAt: job.createdAt.toISOString(),
                appliedAt: job.appliedAt?.toISOString() ?? null,
              }
            : null
        }
      />
    </div>
  );
};

export default ImportarPersonasPage;
