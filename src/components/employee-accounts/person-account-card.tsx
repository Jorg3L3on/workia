"use client";

import { useActionState, useState } from "react";

import { CompanyField } from "@/components/tenant/company-context";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  disableEmployeeAccountAction,
  inviteEmployeeAction,
  issueActivationCodeAction,
  type EmployeeAccountActionState,
} from "@/lib/employee-accounts/actions";
import { formatDateMx, formatDateTimeMx } from "@/lib/format/date";
import { toneFor } from "@/lib/ui/status-tone";

/** The account as the expediente passes it to the client (dates as ISO). */
export type PersonAccountView = {
  status: "invited" | "active" | "disabled";
  email: string | null;
  emailVerified: boolean;
  hasPassword: boolean;
  activatedAt: string | null;
  lastLoginAt: string | null;
  disabledAt: string | null;
  disabledReason: "baja" | "borrado" | "rrhh" | null;
  activationCodeExpiresAt: string | null;
};

const statusLabels = {
  none: "Sin cuenta",
  invited: "Invitación pendiente",
  active: "Activa",
  disabled: "Desactivada",
} as const;

const disabledReasonLabels = {
  baja: "por la baja",
  borrado: "por el borrado del expediente",
  rrhh: "por RH",
} as const;

type PersonAccountCardProps = {
  personId: string;
  /** people.email: the invitation's default address, not an identity. */
  personEmail: string | null;
  account: PersonAccountView | null;
  /** employee_accounts:manage on an active, live expediente. */
  canManage: boolean;
};

const Message = ({ state }: { state: EmployeeAccountActionState }) =>
  state.error ? (
    <p className="text-destructive text-sm" role="alert">
      {state.error}
    </p>
  ) : state.notice ? (
    <p
      className="text-sm font-medium text-[color:var(--workia-accent-blue)]"
      role="status"
    >
      {state.notice}
    </p>
  ) : null;

/**
 * «Cuenta de empleado» on the expediente (W2-01): whether the person can
 * sign in to /mi, and HR's three actions: invite by email, a one-time
 * activation code for someone without email, and disable.
 */
export const PersonAccountControls = ({
  personId,
  personEmail,
  account,
  canManage,
}: PersonAccountCardProps) => {
  const [inviteState, inviteAction, inviting] = useActionState(
    inviteEmployeeAction,
    {},
  );
  const [codeState, codeAction, issuing] = useActionState(
    issueActivationCodeAction,
    {},
  );
  const [disableState, disableAction, disabling] = useActionState(
    disableEmployeeAccountAction,
    {},
  );
  const [disableOpen, setDisableOpen] = useState(false);

  const status = account?.status ?? "none";
  const live = status === "invited" || status === "active";
  const facts = [
    account?.email
      ? {
          label: "Correo de acceso",
          value: `${account.email}${account.emailVerified ? "" : " (sin verificar)"}`,
        }
      : null,
    account?.hasPassword && live
      ? { label: "Entra con", value: "CURP y contraseña" }
      : null,
    account?.activatedAt && live
      ? { label: "Activada", value: formatDateMx(account.activatedAt) }
      : null,
    account?.lastLoginAt && live
      ? { label: "Último acceso", value: formatDateTimeMx(account.lastLoginAt) }
      : null,
    account?.activationCodeExpiresAt
      ? {
          label: "Código de activación vigente hasta",
          value: formatDateTimeMx(account.activationCodeExpiresAt),
        }
      : null,
    status === "disabled" && account?.disabledAt
      ? {
          label: "Desactivada",
          value:
            `${formatDateMx(account.disabledAt)} ${account.disabledReason ? disabledReasonLabels[account.disabledReason] : ""}`.trim(),
        }
      : null,
  ].filter((fact): fact is { label: string; value: string } => fact !== null);

  return (
    <div className="space-y-4" data-testid="employee-account">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={toneFor("employeeAccount", status)}>
          {statusLabels[status]}
        </Badge>
        {status === "none" ? (
          <span className="text-muted-foreground text-sm">
            La persona aún no puede entrar a la app de empleados.
          </span>
        ) : null}
      </div>

      {facts.length > 0 ? (
        <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
          {facts.map((fact) => (
            <div className="min-w-0" key={fact.label}>
              <dt className="workia-field-label">{fact.label}</dt>
              <dd className="font-medium break-words">{fact.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {canManage && status !== "active" ? (
        <form action={inviteAction} className="space-y-2">
          <CompanyField />
          <input name="personId" type="hidden" value={personId} />
          <Label htmlFor="employee-invite-email">Invitar por correo</Label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              autoComplete="off"
              defaultValue={(live ? account?.email : null) ?? personEmail ?? ""}
              id="employee-invite-email"
              inputMode="email"
              name="email"
              placeholder="correo@ejemplo.com"
              type="email"
            />
            <Button disabled={inviting} type="submit">
              {status === "invited" && account?.email
                ? "Reenviar invitación"
                : "Invitar"}
            </Button>
          </div>
          <Message state={inviteState} />
        </form>
      ) : null}

      {canManage ? (
        <form action={codeAction} className="space-y-2">
          <CompanyField />
          <input name="personId" type="hidden" value={personId} />
          <div className="flex flex-wrap items-center gap-2">
            <Button disabled={issuing} type="submit" variant="secondary">
              {status === "active"
                ? "Código para restablecer contraseña"
                : "Generar código de activación"}
            </Button>
            <span className="text-muted-foreground text-xs">
              Para quien no tiene correo: entra con su CURP y este código.
            </span>
          </div>
          {codeState.code ? (
            <div
              className="bg-muted/50 space-y-1 rounded-lg border px-4 py-3"
              role="status"
            >
              <p className="text-sm">
                Entrégale este código. Solo se muestra una vez y vence el{" "}
                {formatDateTimeMx(codeState.codeExpiresAt)}.
              </p>
              <p
                className="font-mono text-xl font-semibold tracking-[0.15em]"
                data-testid="activation-code"
              >
                {codeState.code}
              </p>
              <p className="text-muted-foreground text-xs">
                La persona lo escribe en /mi/activar con su CURP y elige una
                contraseña.
              </p>
            </div>
          ) : null}
          <Message state={codeState} />
        </form>
      ) : null}

      {canManage && live ? (
        <form action={disableAction} id="employee-disable-form">
          <CompanyField />
          <input name="personId" type="hidden" value={personId} />
          <AlertDialog onOpenChange={setDisableOpen} open={disableOpen}>
            <AlertDialogTrigger asChild>
              <Button disabled={disabling} type="button" variant="ghost">
                Desactivar cuenta
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  ¿Desactivar la cuenta de empleado?
                </AlertDialogTitle>
                <AlertDialogDescription>
                  La persona ya no podrá entrar y sus sesiones se cierran ahora.
                  Para volver a darle acceso, invítala de nuevo.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction
                  form="employee-disable-form"
                  onClick={() => setDisableOpen(false)}
                  type="submit"
                >
                  Desactivar
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </form>
      ) : null}
      {/* Outside the form: after a disable the form is gone, the notice stays. */}
      <Message state={disableState} />
    </div>
  );
};
