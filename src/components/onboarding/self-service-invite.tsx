"use client";

import { useActionState } from "react";

import { CompanyField } from "@/components/tenant/company-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatDateTimeMx } from "@/lib/format/date";
import {
  openSelfServiceAction,
  type OpenSelfServiceState,
} from "@/lib/onboarding/intake-actions";

/**
 * «Invitar a completar su alta» (W2-10): opens self-service on the alta and
 * gives the person a way in. With an active account it only reminds them;
 * otherwise an invitation by email or an activation code shown once.
 */
export const SelfServiceInvite = ({
  onboardingId,
  defaultEmail,
  hasActiveAccount,
  opened,
}: {
  onboardingId: string;
  defaultEmail: string;
  hasActiveAccount: boolean;
  /** Self-service is already open: the buttons resend. */
  opened: boolean;
}) => {
  const [state, action, pending] = useActionState<
    OpenSelfServiceState,
    FormData
  >(openSelfServiceAction.bind(null, onboardingId), {});

  return (
    <div className="space-y-3" data-testid="self-service-invite">
      {hasActiveAccount ? (
        <form action={action}>
          <CompanyField />
          <Button disabled={pending} type="submit">
            {opened ? "Recordar a la persona" : "Pedir que complete su alta"}
          </Button>
        </form>
      ) : (
        <>
          <form action={action} className="space-y-2">
            <CompanyField />
            <input name="modo" type="hidden" value="correo" />
            <Label htmlFor="self-service-email">Invitar por correo</Label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                autoComplete="off"
                defaultValue={defaultEmail}
                id="self-service-email"
                inputMode="email"
                name="email"
                placeholder="correo@ejemplo.com"
                type="email"
              />
              <Button disabled={pending} type="submit">
                {opened ? "Reenviar invitación" : "Invitar a completar su alta"}
              </Button>
            </div>
          </form>
          <form action={action} className="flex flex-wrap items-center gap-2">
            <CompanyField />
            <input name="modo" type="hidden" value="codigo" />
            <Button disabled={pending} type="submit" variant="secondary">
              Sin correo: generar código
            </Button>
            <span className="text-muted-foreground text-xs">
              La persona entra a Mi Workia con su CURP y este código.
            </span>
          </form>
        </>
      )}

      {state.code ? (
        <div
          className="bg-muted/50 space-y-1 rounded-lg border px-4 py-3"
          role="status"
        >
          <p className="text-sm">
            Entrégale este código. Solo se muestra una vez y vence el{" "}
            {formatDateTimeMx(state.codeExpiresAt)}.
          </p>
          <p
            className="font-mono text-xl font-semibold tracking-[0.15em]"
            data-testid="self-service-code"
          >
            {state.code}
          </p>
        </div>
      ) : null}
      {state.error ? (
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
      ) : null}
    </div>
  );
};
