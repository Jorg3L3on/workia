"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { DOCUMENT_REJECTION_REASONS } from "@/lib/db/schema/document-review";
import {
  DOCUMENT_FILES_COPY,
  documentRejectionReasonLabels,
} from "@/lib/documents/files-schema";
import { formatDateTimeMx, parseFlexibleDateToIso } from "@/lib/format/date";

export type ReviewQueueItem = {
  id: string;
  personId: string;
  personName: string;
  positionName: string | null;
  requirementName: string;
  validityMonths: number | null;
  uploadedAt: string;
};

export type ReviewDocumentAction = (
  formData: FormData,
) => Promise<{ ok: true } | { error: string }>;

type Decision = { item: ReviewQueueItem; kind: "accept" | "reject" };

const validityHint = (months: number | null) =>
  months
    ? `Vacío: vence a ${months === 1 ? "1 mes" : `${months} meses`} de la fecha en que se subió.`
    : "Vacío: no vence.";

const DecisionForm = ({
  decision,
  action,
  onDone,
  onCancel,
}: {
  decision: Decision;
  action: ReviewDocumentAction;
  onDone: () => void;
  onCancel: () => void;
}) => {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expires, setExpires] = useState("");
  const [noVence, setNoVence] = useState(false);
  const [reason, setReason] = useState("");
  const { item, kind } = decision;

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);

    if (kind === "accept" && !noVence && expires.trim()) {
      const iso = parseFlexibleDateToIso(expires);

      if (!iso) {
        setError("Usa una fecha día/mes/año.");
        return;
      }

      data.set("expiresOn", iso);
    }

    if (kind === "reject" && !reason) {
      setError("Elige el motivo del rechazo.");
      return;
    }

    setPending(true);
    setError(null);

    try {
      const result = await action(data);

      if ("error" in result) {
        setError(result.error);
        return;
      }

      onDone();
    } catch {
      setError("No se pudo guardar la revisión.");
    } finally {
      setPending(false);
    }
  };

  return (
    <form className="space-y-4" noValidate onSubmit={handleSubmit}>
      <CompanyField />
      <input name="documentId" type="hidden" value={item.id} />
      <input name="decision" type="hidden" value={kind} />
      {kind === "accept" ? (
        <>
          {noVence ? <input name="noVence" type="hidden" value="on" /> : null}
          <div className="space-y-2">
            <Label htmlFor="review-expires">Vencimiento (opcional)</Label>
            <Input
              disabled={noVence}
              id="review-expires"
              inputMode="numeric"
              onChange={(event) => setExpires(event.target.value)}
              placeholder="dd/mm/aaaa"
              value={expires}
            />
            <p className="text-muted-foreground text-xs">
              {validityHint(item.validityMonths)}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Switch
              checked={noVence}
              id="review-no-vence"
              onCheckedChange={setNoVence}
            />
            <Label htmlFor="review-no-vence">No vence</Label>
          </div>
        </>
      ) : (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Motivo</legend>
          {DOCUMENT_REJECTION_REASONS.map((value) => (
            <label className="flex items-center gap-2 text-sm" key={value}>
              <input
                checked={reason === value}
                name="reason"
                onChange={() => setReason(value)}
                type="radio"
                value={value}
              />
              {documentRejectionReasonLabels[value]}
            </label>
          ))}
          <p className="text-muted-foreground text-xs">
            La persona ve el motivo y puede subirlo de nuevo. El archivo
            rechazado se borra.
          </p>
        </fieldset>
      )}
      {error ? (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      ) : null}
      <DialogFooter>
        <Button onClick={onCancel} type="button" variant="ghost">
          Cancelar
        </Button>
        <Button
          aria-busy={pending}
          disabled={pending}
          type="submit"
          variant={kind === "accept" ? "primary" : "destructive"}
        >
          {pending ? "Guardando…" : kind === "accept" ? "Aceptar" : "Rechazar"}
        </Button>
      </DialogFooter>
    </form>
  );
};

/**
 * HR's review queue (W2-04): uploads waiting for a decision, oldest first.
 * documents:read opens the files; documents:manage also decides.
 */
export const DocumentReviewQueue = ({
  items,
  total,
  canManage,
  action,
}: {
  items: ReviewQueueItem[];
  total: number;
  canManage: boolean;
  action?: ReviewDocumentAction;
}) => {
  const router = useRouter();
  const [decision, setDecision] = useState<Decision | null>(null);

  if (items.length === 0) {
    return (
      <p className="text-muted-foreground text-sm" role="status">
        {DOCUMENT_FILES_COPY.reviewEmpty}
      </p>
    );
  }

  return (
    <div className="space-y-3" data-testid="document-review-queue">
      <p className="text-muted-foreground text-sm" role="status">
        {total === 1
          ? "1 documento por revisar."
          : `${total.toLocaleString("es-MX")} documentos por revisar.`}
        {total > items.length
          ? ` Se muestran los ${items.length} más antiguos.`
          : ""}
      </p>
      <ul className="divide-border/70 divide-y rounded-lg border">
        {items.map((item) => (
          <li
            className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
            data-testid={`review-row-${item.id}`}
            key={item.id}
          >
            <div className="min-w-0 space-y-0.5">
              <p className="font-medium break-words">{item.requirementName}</p>
              <p className="text-sm break-words">
                <Link
                  className="hover:underline"
                  href={`/app/personas/${item.personId}#documentos`}
                >
                  {item.personName}
                </Link>
                {item.positionName ? (
                  <span className="text-muted-foreground">
                    {" "}
                    · {item.positionName}
                  </span>
                ) : null}
              </p>
              <p className="text-muted-foreground text-xs">
                Subido el {formatDateTimeMx(item.uploadedAt)}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button asChild size="sm" variant="secondary">
                <a
                  href={`/app/documentos/revision/${item.id}/archivo`}
                  rel="noopener"
                  target="_blank"
                >
                  Ver archivo
                </a>
              </Button>
              {canManage && action ? (
                <>
                  <Button
                    onClick={() => setDecision({ item, kind: "accept" })}
                    size="sm"
                    type="button"
                  >
                    Aceptar
                  </Button>
                  <Button
                    onClick={() => setDecision({ item, kind: "reject" })}
                    size="sm"
                    type="button"
                    variant="destructive"
                  >
                    Rechazar
                  </Button>
                </>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
      {decision && action ? (
        <Dialog
          onOpenChange={(open) => {
            if (!open) setDecision(null);
          }}
          open
        >
          <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
            <DialogHeader>
              <DialogTitle>
                {decision.kind === "accept"
                  ? "Aceptar documento"
                  : "Rechazar documento"}
              </DialogTitle>
              <DialogDescription>
                {decision.item.requirementName} de {decision.item.personName}.
                {decision.kind === "accept"
                  ? " Queda como entregado en el expediente."
                  : ""}
              </DialogDescription>
            </DialogHeader>
            <DecisionForm
              action={action}
              decision={decision}
              key={`${decision.item.id}-${decision.kind}`}
              onCancel={() => setDecision(null)}
              onDone={() => {
                setDecision(null);
                router.refresh();
              }}
            />
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
};
