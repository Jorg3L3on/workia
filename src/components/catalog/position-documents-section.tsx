"use client";

import { ChevronDownIcon, ChevronUpIcon, PlusIcon, XIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  startTransition,
  useActionState,
  useEffect,
  useState,
  type FormEvent,
} from "react";

import { CompanyField } from "@/components/tenant/company-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { setRequirementsAction } from "@/lib/documents/actions";
import { requirementNameKey } from "@/lib/documents/schema";
import { cn } from "@/lib/utils";

/** A puesto's required papers. Only these fields: no notes, files or numbers. */
export type PositionDocumentRequirement = {
  id: string;
  name: string;
  required: boolean;
  validityMonths: number | null;
  sort: number;
  active: boolean;
};

type PositionDocumentsSectionProps = {
  positionId: string;
  requirements: PositionDocumentRequirement[];
  canManage: boolean;
  /** Matches the sheet footer's `form` when the footer owns the submit button. */
  formId?: string;
  /** The sheet footer submits; the section does not paint a second button. */
  showSubmit?: boolean;
  onPendingChange?: (pending: boolean) => void;
};

type Draft = {
  key: string;
  id?: string;
  name: string;
  required: boolean;
  months: string;
  noVence: boolean;
  active: boolean;
};

type DraftIssue = {
  message: string;
  nameKeys: string[];
  monthsKeys: string[];
};

const NAME_REQUIRED = "El nombre es obligatorio";
const NAME_MAX = "Máximo 120 caracteres";
const DUPLICATE_NAMES = "Hay nombres repetidos.";
const VIGENCIA_REQUIRED = "Indica los meses de vigencia o marca «No vence».";
const VIGENCIA_RANGE = "La vigencia va de 1 a 120 meses.";
const TOO_MANY = "Máximo 50 documentos por puesto.";

const EMPTY_COPY = "Este puesto no tiene documentos requeridos.";

const toDrafts = (requirements: PositionDocumentRequirement[]): Draft[] =>
  requirements.map((requirement) => ({
    key: requirement.id,
    id: requirement.id,
    name: requirement.name,
    required: requirement.required,
    months:
      requirement.validityMonths === null
        ? ""
        : String(requirement.validityMonths),
    noVence: requirement.validityMonths === null,
    active: requirement.active,
  }));

const validityLabel = (months: number | null) => {
  if (months === null) return "No vence";
  if (months === 1) return "1 mes";

  return `${months} meses`;
};

const inspectDrafts = (drafts: Draft[]): DraftIssue | null => {
  if (drafts.length > 50) {
    return { message: TOO_MANY, nameKeys: [], monthsKeys: [] };
  }

  for (const draft of drafts) {
    const name = draft.name.trim();

    if (!name) {
      return { message: NAME_REQUIRED, nameKeys: [draft.key], monthsKeys: [] };
    }

    if (name.length > 120) {
      return { message: NAME_MAX, nameKeys: [draft.key], monthsKeys: [] };
    }

    if (draft.noVence) continue;

    const months = draft.months.trim();

    if (!months) {
      return {
        message: VIGENCIA_REQUIRED,
        nameKeys: [],
        monthsKeys: [draft.key],
      };
    }

    if (!/^\d+$/.test(months) || Number(months) < 1 || Number(months) > 120) {
      return {
        message: VIGENCIA_RANGE,
        nameKeys: [],
        monthsKeys: [draft.key],
      };
    }
  }

  const folded = drafts.map((draft) => requirementNameKey(draft.name));
  const nameKeys = drafts.flatMap((draft, index) =>
    folded.filter((name) => name === folded[index]).length > 1
      ? [draft.key]
      : [],
  );

  if (nameKeys.length > 0) {
    return { message: DUPLICATE_NAMES, nameKeys, monthsKeys: [] };
  }

  return null;
};

const payloadOf = (positionId: string, drafts: Draft[]) =>
  JSON.stringify({
    positionId,
    requirements: drafts.map((draft, sort) => ({
      ...(draft.id ? { id: draft.id } : {}),
      name: draft.name.trim(),
      required: draft.required,
      validityMonths: draft.noVence ? null : Number(draft.months.trim()),
      sort,
      active: draft.active,
    })),
  });

const PositionDocumentsReadOnly = ({
  requirements,
}: {
  requirements: PositionDocumentRequirement[];
}) => (
  <section aria-label="Documentos requeridos" className="space-y-3">
    <p className="text-muted-foreground text-sm">Solo lectura.</p>
    {requirements.length === 0 ? (
      <p className="text-sm">{EMPTY_COPY}</p>
    ) : (
      <ul aria-label="Documentos del puesto" className="flex flex-col gap-3">
        {requirements.map((requirement) => (
          <li
            className={cn(
              "flex flex-col gap-1 rounded-lg border p-3",
              !requirement.active && "opacity-60",
            )}
            key={requirement.id}
          >
            <span className="font-medium">{requirement.name}</span>
            <span className="text-muted-foreground text-sm">
              {[
                requirement.required ? "Obligatorio" : "Opcional",
                validityLabel(requirement.validityMonths),
                requirement.active ? null : "Inactivo",
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </li>
        ))}
      </ul>
    )}
  </section>
);

const PositionDocumentsEditor = ({
  positionId,
  requirements,
  formId = "position-documents-form",
  showSubmit = true,
  onPendingChange,
}: Omit<PositionDocumentsSectionProps, "canManage">) => {
  const router = useRouter();
  const incoming = JSON.stringify(requirements);
  const [seen, setSeen] = useState(incoming);
  const [drafts, setDrafts] = useState(() => toDrafts(requirements));
  const [clientIssue, setClientIssue] = useState<DraftIssue | null>(null);
  /** Payload sent with the open submit. Edits after that hide the notice. */
  const [ackedPayload, setAckedPayload] = useState<string | null>(null);
  const [state, formAction, pending] = useActionState(
    async (
      _previous: { error?: string; ok?: true } | null,
      formData: FormData,
    ) => {
      const result = await setRequirementsAction(formData);

      if ("error" in result) {
        return { error: result.error };
      }

      router.refresh();
      return { ok: true as const };
    },
    null,
  );

  if (incoming !== seen) {
    setSeen(incoming);
    setDrafts(toDrafts(requirements));
  }

  useEffect(() => {
    onPendingChange?.(pending);

    return () => onPendingChange?.(false);
  }, [onPendingChange, pending]);

  const touch = (recipe: (current: Draft[]) => Draft[]) => {
    setClientIssue(null);
    setDrafts(recipe);
  };

  const payload = payloadOf(positionId, drafts);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const issue = inspectDrafts(drafts);

    if (issue) {
      setClientIssue(issue);
      return;
    }

    const data = new FormData(event.currentTarget);
    setAckedPayload(payload);
    setClientIssue(null);
    startTransition(() => {
      formAction(data);
    });
  };

  const handleAdd = () => {
    touch((current) => [
      ...current,
      {
        key: crypto.randomUUID(),
        name: "",
        required: true,
        months: "",
        noVence: true,
        active: true,
      },
    ]);
  };

  const handleMove = (index: number, direction: -1 | 1) => {
    touch((current) => {
      const next = index + direction;

      if (next < 0 || next >= current.length) return current;

      const copy = [...current];
      const [item] = copy.splice(index, 1);
      copy.splice(next, 0, item);
      return copy;
    });
  };

  const handleRemove = (key: string) => {
    touch((current) => current.filter((draft) => draft.key !== key));
  };

  const patchDraft = (key: string, patch: Partial<Draft>) => {
    touch((current) =>
      current.map((item) => (item.key === key ? { ...item, ...patch } : item)),
    );
  };

  const matchesAck = payload === ackedPayload;
  const errorMessage =
    clientIssue?.message ??
    (matchesAck && !pending ? (state?.error ?? null) : null);
  const saved = matchesAck && !errorMessage && !pending && Boolean(state?.ok);
  const errorId = `${formId}-error`;

  return (
    <form
      action={formAction}
      aria-busy={pending}
      aria-label="Documentos requeridos"
      className="space-y-4"
      id={formId}
      onSubmit={handleSubmit}
    >
      <CompanyField />
      <input name="payload" type="hidden" value={payload} />
      <fieldset
        aria-disabled={pending}
        className={cn("space-y-3", pending && "pointer-events-none opacity-70")}
      >
        <legend className="text-sm font-medium">Documentos requeridos</legend>
        <p className="text-muted-foreground text-sm">
          Nombre, si es obligatorio y la vigencia.
        </p>
        {errorMessage ? (
          <p
            className="text-destructive text-sm font-medium"
            id={errorId}
            role="alert"
          >
            {errorMessage}
          </p>
        ) : null}
        {saved ? (
          <p
            className="text-sm font-medium text-[color:var(--workia-accent-blue)]"
            role="status"
          >
            Documentos guardados.
          </p>
        ) : null}
        {drafts.length === 0 ? (
          <p className="text-sm">{EMPTY_COPY}</p>
        ) : (
          <ul
            aria-label="Documentos del puesto"
            className="flex flex-col gap-3"
          >
            {drafts.map((draft, index) => {
              const nameInvalid = clientIssue?.nameKeys.includes(draft.key);
              const monthsInvalid = clientIssue?.monthsKeys.includes(draft.key);
              const label = draft.name.trim() || "documento";

              return (
                <li
                  className={cn(
                    "space-y-3 rounded-lg border p-3",
                    !draft.active && "opacity-60",
                  )}
                  key={draft.key}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground text-xs">
                      Orden {index + 1}
                    </span>
                    <div className="flex items-center gap-1">
                      <Button
                        aria-label={`Subir ${label}`}
                        disabled={index === 0}
                        onClick={() => handleMove(index, -1)}
                        size="icon-sm"
                        type="button"
                        variant="ghost"
                      >
                        <ChevronUpIcon aria-hidden />
                      </Button>
                      <Button
                        aria-label={`Bajar ${label}`}
                        disabled={index === drafts.length - 1}
                        onClick={() => handleMove(index, 1)}
                        size="icon-sm"
                        type="button"
                        variant="ghost"
                      >
                        <ChevronDownIcon aria-hidden />
                      </Button>
                      {draft.id ? null : (
                        <Button
                          aria-label={`Quitar ${label}`}
                          onClick={() => handleRemove(draft.key)}
                          size="icon-sm"
                          type="button"
                          variant="ghost"
                        >
                          <XIcon aria-hidden />
                        </Button>
                      )}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor={`${draft.key}-name`}>Nombre</Label>
                    <Input
                      aria-describedby={nameInvalid ? errorId : undefined}
                      aria-invalid={nameInvalid || undefined}
                      autoComplete="off"
                      id={`${draft.key}-name`}
                      maxLength={120}
                      onChange={(event) =>
                        patchDraft(draft.key, { name: event.target.value })
                      }
                      placeholder="Ej. Identificación"
                      value={draft.name}
                    />
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <Label htmlFor={`${draft.key}-required`}>Obligatorio</Label>
                    <Switch
                      checked={draft.required}
                      id={`${draft.key}-required`}
                      onCheckedChange={(checked) =>
                        patchDraft(draft.key, { required: checked })
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor={`${draft.key}-months`}>
                      Vigencia (meses)
                    </Label>
                    <Input
                      aria-describedby={monthsInvalid ? errorId : undefined}
                      aria-invalid={monthsInvalid || undefined}
                      disabled={draft.noVence}
                      id={`${draft.key}-months`}
                      inputMode="numeric"
                      onChange={(event) =>
                        patchDraft(draft.key, { months: event.target.value })
                      }
                      placeholder="12"
                      value={draft.months}
                    />
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <Label htmlFor={`${draft.key}-no-vence`}>No vence</Label>
                    <Switch
                      checked={draft.noVence}
                      id={`${draft.key}-no-vence`}
                      onCheckedChange={(checked) =>
                        patchDraft(draft.key, { noVence: checked })
                      }
                    />
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <Label htmlFor={`${draft.key}-active`}>Activo</Label>
                    <Switch
                      checked={draft.active}
                      id={`${draft.key}-active`}
                      onCheckedChange={(checked) =>
                        patchDraft(draft.key, { active: checked })
                      }
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <Button
          disabled={drafts.length >= 50}
          onClick={handleAdd}
          type="button"
          variant="secondary"
        >
          <PlusIcon aria-hidden />
          Agregar documento
        </Button>
      </fieldset>
      {showSubmit ? (
        <Button disabled={pending} type="submit" variant="secondary">
          {pending ? "Guardando…" : "Guardar documentos"}
        </Button>
      ) : null}
    </form>
  );
};

/** List, add, edit, reorder and deactivate the papers of one puesto. */
export const PositionDocumentsSection = ({
  canManage,
  ...props
}: PositionDocumentsSectionProps) => {
  if (!canManage) {
    return <PositionDocumentsReadOnly requirements={props.requirements} />;
  }

  return <PositionDocumentsEditor {...props} />;
};
