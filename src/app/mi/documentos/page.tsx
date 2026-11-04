import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { EmployeeDocumentList } from "@/components/employee/documents/employee-document-list";
import { PrivacyNoticeAccept } from "@/components/employee/documents/privacy-notice-accept";
import {
  employeeUploadBlocker,
  listEmployeeDocuments,
} from "@/lib/documents/files";
import { DOCUMENT_FILES_COPY } from "@/lib/documents/files-schema";
import { requireEmployeeContext } from "@/lib/employee-accounts/session";
import { isoToday } from "@/lib/format/date";
import { pendingPrivacyNotice } from "@/lib/privacy";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Mis documentos" };

/**
 * «Mis documentos» (W2-04): the requirements of the employee's puesto, the
 * same rows HR sees on the expediente, and an upload for each one. Before
 * the first upload the person accepts the privacy notice in force (W2-09).
 */
const EmployeeDocumentsPage = async () => {
  const context = await requireEmployeeContext();
  const today = isoToday();
  const [view, blocker, notice] = await Promise.all([
    listEmployeeDocuments(context, today),
    employeeUploadBlocker(context),
    pendingPrivacyNotice(context.companyId, context.personId),
  ]);

  if (!view) {
    notFound();
  }

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-xl flex-col gap-4 px-4 pt-6 pb-10">
      <header className="flex items-center justify-between gap-3">
        <Link
          className="text-muted-foreground min-h-11 content-center text-sm font-medium"
          href="/mi"
        >
          ← Inicio
        </Link>
      </header>

      <section className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          Mis documentos
        </h1>
        <p className="text-muted-foreground text-sm">
          Toma una foto o elige un PDF de cada documento. RH lo revisa y te
          avisa si hay que repetirlo.
        </p>
      </section>

      {notice ? (
        <PrivacyNoticeAccept
          body={notice.body}
          noticeId={notice.id}
          version={notice.version}
        />
      ) : null}

      {blocker && blocker !== DOCUMENT_FILES_COPY.noticePending ? (
        <p
          className="workia-pass-card text-muted-foreground px-5 py-4 text-sm"
          role="status"
        >
          {blocker}
        </p>
      ) : null}

      <EmployeeDocumentList
        canUpload={!blocker}
        message={view.message}
        rows={view.rows}
        state={view.state}
      />
    </main>
  );
};

export default EmployeeDocumentsPage;
