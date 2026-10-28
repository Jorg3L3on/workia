import type { Metadata } from "next";
import { Suspense } from "react";

import { ExpiringDocumentsLoader } from "@/components/documents/expiring-documents-loader";
import { PageHeader } from "@/components/layout/page-header";
import { SectionSkeleton } from "@/components/loading/page-skeletons";
import { pageTitles } from "@/lib/brand/chrome-copy";
import {
  EXPIRING_DOCUMENTS_COPY,
  expiringStatusFromParam,
} from "@/lib/documents/expiring";
import { requireDocumentsRead } from "@/lib/documents/auth";
import { isoToday } from "@/lib/format/date";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: pageTitles.documentos,
};

type DocumentosPageProps = {
  searchParams: Promise<{
    puesto?: string;
    estado?: string;
  }>;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const DocumentosPage = async ({ searchParams }: DocumentosPageProps) => {
  const session = await requireDocumentsRead();
  const filters = await searchParams;
  const status = expiringStatusFromParam(filters.estado);
  const positionId = UUID.test(filters.puesto ?? "")
    ? filters.puesto
    : undefined;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        description={
          status === "expired"
            ? EXPIRING_DOCUMENTS_COPY.expiredDescription
            : EXPIRING_DOCUMENTS_COPY.description
        }
        title={EXPIRING_DOCUMENTS_COPY.title}
      />
      <Suspense
        fallback={
          <div
            aria-busy="true"
            aria-label={EXPIRING_DOCUMENTS_COPY.loading}
            role="status"
          >
            <SectionSkeleton />
          </div>
        }
      >
        <ExpiringDocumentsLoader
          companyId={session.companyId}
          positionId={positionId}
          status={status}
          today={isoToday()}
        />
      </Suspense>
    </div>
  );
};

export default DocumentosPage;
