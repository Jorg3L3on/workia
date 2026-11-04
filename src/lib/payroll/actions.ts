"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requestOrigin } from "@/lib/employee-accounts/session";
import { AuthorizationError } from "@/lib/rbac/errors";
import {
  STALE_COMPANY_MESSAGE,
  writableCompanyIdFromForm,
} from "@/lib/tenant/scope";
import { searchPeopleForPrivacy } from "@/lib/privacy";

import { requirePayrollManage } from "./auth";
import {
  assignPayrollReceipt,
  createPayrollPeriod,
  discardPayrollPeriod,
  publishPayrollPeriod,
  recordPayrollImport,
} from "./index";
import {
  assignReceiptSchema,
  createPeriodSchema,
  PAYROLL_COPY,
  type PayrollActionState,
} from "./schema";

const PAYROLL_PATH = "/app/nomina";

const revalidatePayroll = (periodId?: string) => {
  revalidatePath(PAYROLL_PATH);

  if (periodId) {
    revalidatePath(`${PAYROLL_PATH}/${periodId}`);
  }

  revalidatePath("/app/auditoria");
};

const text = (formData: FormData, key: string) => {
  const value = formData.get(key);

  return typeof value === "string" ? value : "";
};

/** The manage session and the company the form was rendered for, or an error state. */
const manageContext = async (formData: FormData) => {
  let session: Awaited<ReturnType<typeof requirePayrollManage>>;

  try {
    session = await requirePayrollManage();
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return { error: PAYROLL_COPY.denied } as const;
    }

    redirect("/login");
  }

  try {
    return {
      userId: session.user.id,
      companyId: writableCompanyIdFromForm(session, formData),
    } as const;
  } catch {
    return { error: STALE_COMPANY_MESSAGE } as const;
  }
};

/** Creates the draft period the import dialog uploads into. */
export const createPayrollPeriodAction = async (
  _state: PayrollActionState,
  formData: FormData,
): Promise<PayrollActionState> => {
  const context = await manageContext(formData);

  if ("error" in context) {
    return { error: context.error };
  }

  const parsed = createPeriodSchema.safeParse({
    label: text(formData, "label"),
    periodStart: text(formData, "periodStart"),
    periodEnd: text(formData, "periodEnd"),
  });

  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? PAYROLL_COPY.periodLabel,
    };
  }

  const result = await createPayrollPeriod(
    context.companyId,
    parsed.data,
    context.userId,
  );

  if (!result.ok) {
    return { error: result.error };
  }

  revalidatePayroll();
  return {
    ok: true,
    message: PAYROLL_COPY.periodCreated,
    periodId: result.value.id,
  };
};

const count = (formData: FormData, key: string) => {
  const value = Number.parseInt(text(formData, key), 10);

  return Number.isFinite(value) && value >= 0 ? Math.min(value, 100_000) : 0;
};

/** Writes the one audit event of an import, after the browser uploaded every receipt. */
export const finishPayrollImportAction = async (
  _state: PayrollActionState,
  formData: FormData,
): Promise<PayrollActionState> => {
  const context = await manageContext(formData);

  if ("error" in context) {
    return { error: context.error };
  }

  const periodId = text(formData, "periodId");
  const period = await recordPayrollImport(
    context.companyId,
    periodId,
    {
      matched: count(formData, "matched"),
      unmatched: count(formData, "unmatched"),
      duplicate: count(formData, "duplicate"),
      invalid: count(formData, "invalid"),
    },
    context.userId,
  ).catch(() => null);

  if (!period) {
    return { error: PAYROLL_COPY.periodNotFound };
  }

  revalidatePayroll(period.id);
  return { ok: true, periodId: period.id };
};

/** HR matches an unmatched receipt to a person. */
export const assignPayrollReceiptAction = async (
  _state: PayrollActionState,
  formData: FormData,
): Promise<PayrollActionState> => {
  const context = await manageContext(formData);

  if ("error" in context) {
    return { error: context.error };
  }

  const parsed = assignReceiptSchema.safeParse({
    receiptId: text(formData, "receiptId"),
    personId: text(formData, "personId"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? PAYROLL_COPY.person };
  }

  const result = await assignPayrollReceipt(
    context.companyId,
    parsed.data.receiptId,
    parsed.data.personId,
    context.userId,
  );

  if (!result.ok) {
    return { error: result.error };
  }

  revalidatePayroll(text(formData, "periodId") || undefined);
  return { ok: true, message: PAYROLL_COPY.receiptAssigned };
};

/** Publishes the period: matched receipts are delivered and announced by email. */
export const publishPayrollPeriodAction = async (
  _state: PayrollActionState,
  formData: FormData,
): Promise<PayrollActionState> => {
  const context = await manageContext(formData);

  if ("error" in context) {
    return { error: context.error };
  }

  const periodId = text(formData, "periodId");
  const result = await publishPayrollPeriod(
    context.companyId,
    periodId,
    context.userId,
    { origin: await requestOrigin() },
  );

  if (!result.ok) {
    return { error: result.error };
  }

  revalidatePayroll(periodId);
  return {
    ok: true,
    message: `${PAYROLL_COPY.periodPublished} ${result.value.delivered} ${result.value.delivered === 1 ? "persona" : "personas"}, ${result.value.emailed} ${result.value.emailed === 1 ? "correo enviado" : "correos enviados"}.`,
  };
};

/** Discards a draft period and its files, then goes back to the list. */
export const discardPayrollPeriodAction = async (
  _state: PayrollActionState,
  formData: FormData,
): Promise<PayrollActionState> => {
  const context = await manageContext(formData);

  if ("error" in context) {
    return { error: context.error };
  }

  const result = await discardPayrollPeriod(
    context.companyId,
    text(formData, "periodId"),
    context.userId,
  );

  if (!result.ok) {
    return { error: result.error };
  }

  revalidatePayroll();
  redirect(PAYROLL_PATH);
};

/** Person search for matching a receipt by hand; people on baja included. */
export const searchPayrollPeopleAction = async (query: string) => {
  try {
    const session = await requirePayrollManage();

    return await searchPeopleForPrivacy(session.companyId, query);
  } catch {
    return [];
  }
};
