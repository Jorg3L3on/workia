import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PrivacyNoticeAccept } from "@/components/employee/documents/privacy-notice-accept";
import { IntakeForm } from "@/components/employee/onboarding/intake-form";
import { listEmployeeDocuments } from "@/lib/documents/files";
import { requireEmployeeContext } from "@/lib/employee-accounts/session";
import { isoToday } from "@/lib/format/date";
import {
  employeeIntakeBlocker,
  getEmployeeIntake,
} from "@/lib/onboarding/intake";
import {
  INTAKE_COPY,
  intakeReturnReasonLabels,
} from "@/lib/onboarding/intake-schema";
import { pendingPrivacyNotice } from "@/lib/privacy";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Completa tu alta" };

/**
 * «Completa tu alta» (W2-10): the new hire fills their personal data,
 * address and beneficiaries, and uploads their documents, before day one.
 * HR reviews what they send. Everything comes from the session's person.
 */
const EmployeeIntakePage = async () => {
  const context = await requireEmployeeContext();
  const view = await getEmployeeIntake(context);

  if (!view) {
    notFound();
  }

  const [blocker, notice, documents] = await Promise.all([
    employeeIntakeBlocker(context),
    pendingPrivacyNotice(context.companyId, context.personId),
    listEmployeeDocuments(context, isoToday()),
  ]);
  const rows = documents?.rows ?? [];
  const delivered = rows.filter((row) => row.status !== "missing").length;
  const inReview = rows.filter(
    (row) => row.review?.status === "uploaded",
  ).length;
  const { intake } = view;

  const status = !view.altaOpen
    ? intake.status === "aplicado"
      ? "RH ya aplicó tus datos a tu expediente. Gracias."
      : INTAKE_COPY.notOpen
    : intake.status === "enviado"
      ? INTAKE_COPY.locked
      : intake.status === "aplicado"
        ? "RH ya aplicó tus datos a tu expediente. Gracias."
        : intake.status === "devuelto" && intake.returnReason
          ? `RH te pide corregir: ${intakeReturnReasonLabels[intake.returnReason]}. Revisa y vuelve a enviar.`
          : null;

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
          Completa tu alta
        </h1>
        <p className="text-muted-foreground text-sm">
          Llena tus datos y sube tus documentos antes de tu primer día. Puedes
          guardar y seguir después; cuando esté completo, envíalo a RH.
        </p>
      </section>

      {status ? (
        <p
          className="workia-pass-card px-5 py-4 text-sm font-medium"
          data-testid="intake-status"
          role="status"
        >
          {status}
        </p>
      ) : null}

      {notice && view.editable ? (
        <PrivacyNoticeAccept
          body={notice.body}
          noticeId={notice.id}
          version={notice.version}
        />
      ) : null}

      {blocker && blocker !== INTAKE_COPY.noticePending && view.editable ? (
        <p
          className="workia-pass-card text-muted-foreground px-5 py-4 text-sm"
          role="status"
        >
          {blocker}
        </p>
      ) : null}

      <IntakeForm editable={view.editable && !blocker} values={view.data} />

      <Link
        className="workia-pass-card flex min-h-11 items-center justify-between gap-3 px-5 py-4"
        href="/mi/documentos"
      >
        <span className="flex flex-col">
          <span className="text-base font-semibold">Mis documentos</span>
          <span className="text-muted-foreground text-sm">
            {rows.length === 0
              ? "Tu puesto aún no tiene documentos pedidos."
              : `${delivered} de ${rows.length} entregados${inReview > 0 ? ` · ${inReview} en revisión` : ""}`}
          </span>
        </span>
        <span aria-hidden className="text-muted-foreground">
          →
        </span>
      </Link>
    </main>
  );
};

export default EmployeeIntakePage;
