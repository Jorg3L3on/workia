"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  getEmployeeAccount,
  inviteEmployee,
  issueActivationCode,
} from "@/lib/employee-accounts";
import { sendInvitationEmail } from "@/lib/employee-accounts/emails";
import { requestOrigin } from "@/lib/employee-accounts/session";
import { logger } from "@/lib/logger";
import { userHasPermission } from "@/lib/rbac";
import { AuthorizationError } from "@/lib/rbac/errors";
import { requireCompanyContext } from "@/lib/tenant/context";
import {
  STALE_COMPANY_MESSAGE,
  writableCompanyIdFromForm,
} from "@/lib/tenant/scope";

import { getOnboardingById } from "./index";
import {
  applyIntake,
  getIntakeForOnboarding,
  openSelfService,
  returnIntake,
} from "./intake";
import { INTAKE_COPY } from "./intake-schema";

/**
 * HR's side of self-service onboarding (W2-10), on the alta page: open it
 * and give the person access, apply what they sent, or send it back. Every
 * action needs people:update in the active company, like the alta itself.
 */

const ALTAS = "/app/altas";

export type OpenSelfServiceState = {
  error?: string;
  notice?: string;
  /** Activation code for a person without email, shown once. */
  code?: string;
  codeExpiresAt?: string;
};

const DENIED = "No tienes permiso para esta acción en esta etapa.";

const requireHr = async () => {
  try {
    return await requireCompanyContext("people:update");
  } catch (error) {
    if (error instanceof AuthorizationError) return null;
    redirect("/login");
  }
};

const revalidate = (onboardingId: string, personId?: string) => {
  revalidatePath(`${ALTAS}/${onboardingId}`);
  revalidatePath("/app/auditoria");
  if (personId) revalidatePath(`/app/personas/${personId}`);
};

/**
 * Opens self-service on the alta (or keeps the one already open) and gives
 * the person a way in: an invitation email, or an activation code shown
 * once. A person with an active account gets a reminder email instead.
 * Creating access needs employee_accounts:manage, as on the expediente.
 */
export const openSelfServiceAction = async (
  onboardingId: string,
  _state: OpenSelfServiceState,
  formData: FormData,
): Promise<OpenSelfServiceState> => {
  const session = await requireHr();
  if (!session) return { error: DENIED };

  let companyId: string;
  try {
    companyId = writableCompanyIdFromForm(session, formData);
  } catch {
    return { error: STALE_COMPANY_MESSAGE };
  }

  const alta = await getOnboardingById(companyId, onboardingId);
  if (!alta) return { error: "Alta no encontrada." };
  if (alta.onboarding.stage !== "rh_captura") {
    return { error: INTAKE_COPY.hrNotOpen };
  }

  const existing = await getIntakeForOnboarding(companyId, onboardingId);
  if (
    existing &&
    existing.status !== "invitado" &&
    existing.status !== "devuelto"
  ) {
    return { error: INTAKE_COPY.hrExists };
  }

  const personId = alta.person.id;
  const mode = formData.get("modo") === "codigo" ? "codigo" : "correo";
  const account = await getEmployeeAccount(companyId, personId);
  const active = account?.status === "active";
  let result: OpenSelfServiceState = {};

  if (active) {
    if (account.email) {
      try {
        await sendInvitationEmail({
          to: account.email,
          origin: await requestOrigin(),
          purpose: "onboarding",
        });
        result = { notice: `Aviso enviado a ${account.email}.` };
      } catch (error) {
        logger.error({ err: error, companyId }, "Onboarding email failed");
        result = {
          notice:
            "La persona ya tiene cuenta. No se pudo enviar el correo: avísale que entre a Mi Workia.",
        };
      }
    } else {
      result = {
        notice:
          "La persona ya tiene cuenta (entra con CURP y contraseña). Avísale que entre a Mi Workia.",
      };
    }
  } else {
    if (
      !(await userHasPermission(session.user.id, "employee_accounts:manage"))
    ) {
      return {
        error:
          "Dar acceso a la app de empleados necesita el permiso de cuentas de empleado. Pide a un administrador que invite a la persona.",
      };
    }

    if (mode === "codigo") {
      const issued = await issueActivationCode(
        companyId,
        personId,
        session.user.id,
      );
      if (!issued) return { error: "Persona no encontrada." };
      if (!issued.ok) return { error: issued.error };
      result = {
        code: issued.code,
        codeExpiresAt: issued.expiresAt.toISOString(),
      };
    } else {
      const invited = await inviteEmployee(
        companyId,
        personId,
        String(formData.get("email") ?? ""),
        session.user.id,
        { origin: await requestOrigin(), purpose: "onboarding" },
      );
      if (!invited) return { error: "Persona no encontrada." };
      if (!invited.ok) return { error: invited.error };
      result = invited.emailSent
        ? { notice: `Invitación enviada a ${invited.email}.` }
        : {
            notice:
              "La invitación quedó registrada pero el correo no salió. Genera un código de activación para dárselo a la persona.",
          };
    }
  }

  if (!existing) {
    const opened = await openSelfService(
      companyId,
      onboardingId,
      session.user.id,
    );
    if (!opened.ok && opened.error !== INTAKE_COPY.hrExists) {
      return { error: opened.error };
    }
  }

  revalidate(onboardingId, personId);
  return result;
};

const back = (onboardingId: string, query: Record<string, string>): never =>
  redirect(`${ALTAS}/${onboardingId}?${new URLSearchParams(query)}`);

const decide = async (
  onboardingId: string,
  formData: FormData,
  run: (
    companyId: string,
    actorUserId: string,
  ) => Promise<{ ok: true } | { ok: false; error: string }>,
  success: string,
) => {
  const session = await requireHr();
  if (!session) back(onboardingId, { error: "permission" });

  let companyId: string;
  try {
    companyId = writableCompanyIdFromForm(session!, formData);
  } catch {
    back(onboardingId, { error: "company-changed" });
  }

  const result = await run(companyId!, session!.user.id);
  if (!result.ok)
    back(onboardingId, { error: "domain", message: result.error });

  revalidate(onboardingId);
  back(onboardingId, { intake: success });
};

/** «Aplicar al expediente»: the person's values go to their record. */
export const applyIntakeAction = async (
  onboardingId: string,
  formData: FormData,
) =>
  decide(
    onboardingId,
    formData,
    (companyId, actor) => applyIntake(companyId, onboardingId, actor),
    "applied",
  );

/** «Devolver a la persona», with a reason from the closed list. */
export const returnIntakeAction = async (
  onboardingId: string,
  formData: FormData,
) =>
  decide(
    onboardingId,
    formData,
    (companyId, actor) =>
      returnIntake(
        companyId,
        onboardingId,
        String(formData.get("motivo") ?? ""),
        actor,
      ),
    "returned",
  );
