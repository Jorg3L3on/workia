"use client";

import { useActionState, useState } from "react";
import { CheckIcon, CopyIcon } from "lucide-react";

import { CompanyField } from "@/components/tenant/company-context";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FormSelect } from "@/components/ui/form-select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  createPersonalTokenAction,
  type CreateTokenState,
} from "@/lib/mcp/actions";
import { formatDateMx } from "@/lib/format/date";
import {
  TOKEN_PRESETS,
  tokenPresetLabels,
  type TokenPreset,
} from "@/lib/mcp/presets";
import { scopeLabels, type McpScope } from "@/lib/mcp/scopes";

type CreateTokenFormProps = {
  /** Scopes the user's role can grant (offline_access excluded: PATs do not refresh). */
  grantable: McpScope[];
  mcpUrl: string;
};

const CopyBlock = ({ label, value }: { label: string; value: string }) => {
  const [copied, setCopied] = useState(false);

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">{label}</span>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => {
            void navigator.clipboard?.writeText(value).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
        >
          {copied ? <CheckIcon aria-hidden /> : <CopyIcon aria-hidden />}
          {copied ? "Copiado" : "Copiar"}
        </Button>
      </div>
      <pre className="bg-muted overflow-x-auto rounded-md p-3 font-mono text-xs break-all whitespace-pre-wrap">
        {value}
      </pre>
    </div>
  );
};

/** Shown once after creating a token: the token and how to plug it into each client. */
const TokenOnceDialog = ({
  state,
  mcpUrl,
  onClose,
}: {
  state: CreateTokenState;
  mcpUrl: string;
  onClose: () => void;
}) => {
  const token = state.token ?? "";
  const cursorConfig = JSON.stringify(
    {
      mcpServers: {
        workia: { url: mcpUrl, headers: { Authorization: `Bearer ${token}` } },
      },
    },
    null,
    2,
  );

  return (
    <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent className="sm:max-w-xl" data-testid="token-once-dialog">
        <DialogHeader>
          <DialogTitle>Token «{state.name}» creado</DialogTitle>
          <DialogDescription>
            Cópialo ahora: no se vuelve a mostrar. Vence el{" "}
            {formatDateMx(state.expiresAt)}. Permisos:{" "}
            {(state.scopes ?? [])
              .map((scope) => scopeLabels[scope as McpScope]?.label ?? scope)
              .join(", ")}
            .
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <CopyBlock label="Token" value={token} />
          <CopyBlock
            label="Grok Bot (conector MCP remoto)"
            value={`URL: ${mcpUrl}\nAuthorization: Bearer ${token}`}
          />
          <CopyBlock label="Cursor (mcp.json)" value={cursorConfig} />
        </div>
        <DialogFooter>
          <Button type="button" onClick={onClose}>
            Ya lo copié
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export const CreateTokenForm = ({
  grantable,
  mcpUrl,
}: CreateTokenFormProps) => {
  const [state, action, pending] = useActionState<CreateTokenState, FormData>(
    createPersonalTokenAction,
    {},
  );
  const [preset, setPreset] = useState<TokenPreset>("solo_lectura");
  const [dismissed, setDismissed] = useState<string | null>(null);
  const customChoices = grantable.filter(
    (scope) => scope !== "read" && scope !== "offline_access",
  );

  return (
    <form
      action={action}
      className="flex flex-col gap-4"
      data-testid="create-token-form"
    >
      <CompanyField />
      <div className="grid gap-3 sm:grid-cols-[1fr_14rem_10rem]">
        <div className="space-y-2">
          <Label htmlFor="token-name">Nombre</Label>
          <Input
            id="token-name"
            name="name"
            placeholder="Grok Bot de RRHH"
            maxLength={80}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="token-preset">Permisos</Label>
          <FormSelect
            id="token-preset"
            name="preset"
            value={preset}
            onValueChange={(value) => setPreset(value as TokenPreset)}
            options={TOKEN_PRESETS.map((value) => ({
              value,
              label: tokenPresetLabels[value].label,
            }))}
            variant="field"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="token-expiry">Vence en</Label>
          <FormSelect
            id="token-expiry"
            name="expiresInDays"
            defaultValue="30"
            options={[
              { value: "7", label: "7 días" },
              { value: "30", label: "30 días" },
              { value: "90", label: "90 días" },
            ]}
            variant="field"
          />
        </div>
      </div>
      <p className="text-muted-foreground text-sm">
        {tokenPresetLabels[preset].hint}
      </p>
      {preset === "personalizado" ? (
        <fieldset className="grid gap-2 sm:grid-cols-2">
          <legend className="sr-only">Permisos personalizados</legend>
          {customChoices.map((scope) => (
            <label
              key={scope}
              className="flex items-start gap-2 rounded-md border p-3 text-sm"
            >
              <input
                type="checkbox"
                name="scopes"
                value={scope}
                className="accent-primary mt-0.5 size-4"
              />
              <span className="grid gap-0.5">
                <span className="font-medium">{scopeLabels[scope].label}</span>
                <span className="text-muted-foreground text-xs">
                  {scopeLabels[scope].hint}
                </span>
              </span>
            </label>
          ))}
        </fieldset>
      ) : null}
      {state.error ? (
        <p role="alert" className="text-destructive text-sm">
          {state.error}
        </p>
      ) : null}
      <div>
        <Button type="submit" disabled={pending}>
          Crear token
        </Button>
      </div>
      {state.token && dismissed !== state.token ? (
        <TokenOnceDialog
          state={state}
          mcpUrl={mcpUrl}
          onClose={() => setDismissed(state.token ?? null)}
        />
      ) : null}
    </form>
  );
};
