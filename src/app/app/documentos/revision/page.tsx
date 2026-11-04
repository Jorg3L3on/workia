import type { Metadata } from "next";

import { DocumentReviewQueue } from "@/components/documents/document-review-queue";
import { PageHeader } from "@/components/layout/page-header";
import { reviewDocumentAction } from "@/lib/documents/actions";
import { requireDocumentsRead } from "@/lib/documents/auth";
import { listDocumentReviewQueue } from "@/lib/documents/files";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Documentos por revisar",
};

/**
 * Review queue (W2-04): files employees uploaded from the app, oldest
 * first. documents:read sees and opens them; documents:manage decides.
 */
const DocumentReviewPage = async () => {
  const session = await requireDocumentsRead();
  const canManage = session.permissions.has("documents:manage");
  const queue = await listDocumentReviewQueue(session.companyId);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        description="Archivos que las personas subieron desde la app. Al aceptarlo queda como entregado en el expediente; al rechazarlo la persona ve el motivo y puede subirlo de nuevo."
        secondary={{ label: "Por vencer", href: "/app/documentos" }}
        title="Documentos por revisar"
      />
      <DocumentReviewQueue
        action={canManage ? reviewDocumentAction : undefined}
        canManage={canManage}
        items={queue.rows.map((row) => ({
          id: row.id,
          personId: row.personId,
          personName: row.personName,
          positionName: row.positionName,
          requirementName: row.requirementName,
          validityMonths: row.validityMonths,
          uploadedAt: row.uploadedAt.toISOString(),
        }))}
        total={queue.total}
      />
    </div>
  );
};

export default DocumentReviewPage;
