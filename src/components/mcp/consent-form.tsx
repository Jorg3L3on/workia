"use client";

import { useActionState } from "react";

import {
  approveConsentAction,
  denyConsentAction,
  type ConsentActionState,
} from "@/lib/mcp/oauth/consent-actions";
import { scopeLabels, type McpScope } from "@/lib/mcp/scopes";

type ConsentFormProps = {
  params: Record<string, string>;
  companyId: string;
  offerable: McpScope[];
  requested: McpScope[];
  isChatgpt: boolean;
};

const hiddenFields = (params: Record<string, string>) =>
  Object.entries(params).map(([name, value]) => (
    <input key={name} type="hidden" name={name} value={value} />
  ));

/** Scopes as checkboxes: read is fixed, the rest start as the client asked (pii never pre-ticked). */
export const ConsentForm = ({
  params,
  companyId,
  offerable,
  requested,
  isChatgpt,
}: ConsentFormProps) => {
  const [state, approve, pending] = useActionState<
    ConsentActionState,
    FormData
  >(approveConsentAction, {});
  const choices = offerable.filter((scope) => scope !== "offline_access");

  return (
    <div className="flex flex-col gap-4">
      <form action={approve} className="flex flex-col gap-4">
        {hiddenFields(params)}
        <input type="hidden" name="company_id" value={companyId} />
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 font-mono text-[10.5px] font-medium tracking-[0.09em] text-[color:var(--login-ink-faint)] uppercase">
            Permisos
          </legend>
          {choices.map((scope) => {
            const fixed = scope === "read";
            const warn = scope === "pii" && isChatgpt;

            return (
              <label
                key={scope}
                className="flex items-start gap-3 rounded-lg border border-[color:var(--login-line)] px-3.5 py-3"
              >
                <input
                  type="checkbox"
                  name="scope_choice"
                  value={scope}
                  defaultChecked={
                    fixed || (scope !== "pii" && requested.includes(scope))
                  }
                  disabled={fixed}
                  className="mt-0.5 size-4 accent-[color:var(--login-accent-blue)]"
                />
                <span className="grid gap-0.5">
                  <span className="text-[14px] font-semibold text-[color:var(--login-ink)]">
                    {scopeLabels[scope].label}
                  </span>
                  <span className="text-[12.5px] text-[color:var(--login-ink-muted)]">
                    {scopeLabels[scope].hint}
                  </span>
                  {warn ? (
                    <span className="text-destructive text-[12.5px]">
                      Advertencia: ChatGPT es un servicio externo. Con este
                      permiso verá los datos personales completos.
                    </span>
                  ) : null}
                </span>
              </label>
            );
          })}
        </fieldset>
        {isChatgpt ? (
          <p className="text-[12.5px] text-[color:var(--login-ink-muted)]">
            ChatGPT sólo puede leer. Para hacer cambios usa Grok Bot o la app de
            Workia.
          </p>
        ) : null}
        {state.error ? (
          <p role="alert" className="text-destructive text-sm">
            {state.error}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={pending}
          className="login-stamp-btn min-h-11 w-full rounded-lg py-3 text-[15px] font-semibold transition-[transform,box-shadow] duration-150 focus-visible:ring-2 focus-visible:ring-[color:var(--login-accent-violet)] focus-visible:outline-none disabled:opacity-80"
        >
          Permitir acceso
        </button>
      </form>
      <form action={denyConsentAction}>
        {hiddenFields(params)}
        <button
          type="submit"
          className="min-h-11 w-full rounded-lg border border-[color:var(--login-line)] py-3 text-[14px] font-medium text-[color:var(--login-ink)] transition-colors hover:bg-[color:var(--login-line)]/40"
        >
          Cancelar
        </button>
      </form>
    </div>
  );
};
