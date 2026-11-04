"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type ChangeEvent } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DOCUMENT_FILE_ACCEPT,
  DOCUMENT_FILE_MAX_BYTES,
  DOCUMENT_FILES_COPY,
  documentRejectionReasonLabels,
} from "@/lib/documents/files-schema";
import {
  DOCUMENT_STATUS_LABELS,
  PERSON_DOCUMENT_CARD_COPY,
  type PersonDocumentCardState,
  type PersonDocumentRow,
} from "@/lib/documents/person-card";
import { formatDateMx } from "@/lib/format/date";
import { toneFor, type Tone } from "@/lib/ui/status-tone";

import { shrinkImage } from "./shrink-image";

type EmployeeDocumentListProps = {
  rows: PersonDocumentRow[];
  state: Exclude<PersonDocumentCardState, "error"> | "error";
  message: string;
  canUpload: boolean;
};

const chip = (row: PersonDocumentRow): { tone: Tone; label: string } => {
  if (row.review?.status === "uploaded") {
    return { tone: "info", label: "En revisión" };
  }

  if (row.review?.status === "rejected") {
    return { tone: "danger", label: "Rechazado" };
  }

  return {
    tone: toneFor("document", row.status),
    label: DOCUMENT_STATUS_LABELS[row.status],
  };
};

const uploadLabel = (row: PersonDocumentRow) => {
  if (row.review?.status === "rejected") return "Subir de nuevo";
  if (row.status === "missing") return "Subir foto o PDF";
  return "Subir uno nuevo";
};

/** The card's summary in the employee's words. */
const employeeMessage = (
  state: EmployeeDocumentListProps["state"],
  message: string,
) => {
  switch (state) {
    case "empty":
      return message === PERSON_DOCUMENT_CARD_COPY.emptyPerson
        ? "RH aún no captura tu puesto."
        : "Tu puesto no pide documentos.";
    case "missing":
      return "Te faltan documentos.";
    case "expiring":
      return "Tienes documentos por vencer.";
    case "expired":
      return "Tienes documentos vencidos.";
    case "ok":
      return PERSON_DOCUMENT_CARD_COPY.ok;
    default:
      return message;
  }
};

type Picked = { blob: Blob; name: string; preview: string | null };

/**
 * One row per requirement. Uploading is two steps: pick (the phone offers
 * the camera, the gallery and files) and send. A pending upload cannot be
 * replaced until HR reviews it.
 */
const DocumentRow = ({
  row,
  canUpload,
}: {
  row: PersonDocumentRow;
  canUpload: boolean;
}) => {
  const router = useRouter();
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  const status = chip(row);
  const pending = row.review?.status === "uploaded";

  useEffect(
    () => () => {
      if (picked?.preview) URL.revokeObjectURL(picked.preview);
    },
    [picked],
  );

  const handlePick = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    setError(null);
    setDone(false);

    if (!file) return;

    const blob = await shrinkImage(file);

    if (blob.size > DOCUMENT_FILE_MAX_BYTES) {
      setError(DOCUMENT_FILES_COPY.tooLarge);
      return;
    }

    setPicked({
      blob,
      name: file.name,
      preview: blob.type.startsWith("image/")
        ? URL.createObjectURL(blob)
        : null,
    });
  };

  const handleSend = async () => {
    if (!picked) return;

    setSending(true);
    setError(null);

    const body = new FormData();
    body.set("requirementId", row.requirementId);
    body.set("file", picked.blob, picked.name);

    try {
      const response = await fetch("/api/mi/documentos", {
        method: "POST",
        body,
      });
      const result = (await response.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
      } | null;

      if (!response.ok || !result?.ok) {
        setError(
          result?.error ??
            (response.status === 413
              ? DOCUMENT_FILES_COPY.tooLarge
              : DOCUMENT_FILES_COPY.uploadFailed),
        );
        return;
      }

      setPicked(null);
      setDone(true);
      router.refresh();
    } catch {
      setError(DOCUMENT_FILES_COPY.uploadFailed);
    } finally {
      setSending(false);
    }
  };

  return (
    <li
      className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0"
      data-status={row.review?.status ?? row.status}
      data-testid={`employee-document-${row.requirementId}`}
    >
      <div className="flex items-start justify-between gap-3">
        <span className="min-w-0 font-medium break-words">{row.name}</span>
        <Badge tone={status.tone}>{status.label}</Badge>
      </div>

      {row.review?.status === "rejected" && row.review.rejectionReason ? (
        <p className="text-destructive text-sm">
          Motivo: {documentRejectionReasonLabels[row.review.rejectionReason]}
        </p>
      ) : null}
      {pending ? (
        <p className="text-muted-foreground text-sm">
          Enviado el {formatDateMx(row.review!.uploadedAt.slice(0, 10))}. RH lo
          está revisando.
        </p>
      ) : row.deliveredOn ? (
        <p className="text-muted-foreground text-sm">
          Entregado el {formatDateMx(row.deliveredOn)}
          {row.expiresOn ? ` · vence el ${formatDateMx(row.expiresOn)}` : ""}
        </p>
      ) : null}

      {done ? (
        <p className="text-sm" role="status">
          {DOCUMENT_FILES_COPY.uploaded}
        </p>
      ) : null}

      {canUpload && !pending ? (
        picked ? (
          <div className="flex flex-col gap-3">
            {picked.preview ? (
              // eslint-disable-next-line @next/next/no-img-element -- local blob preview
              <img
                alt={`Vista previa de ${row.name}`}
                className="max-h-56 w-full rounded-md object-contain"
                src={picked.preview}
              />
            ) : (
              <p className="text-sm break-words">{picked.name}</p>
            )}
            <div className="grid grid-cols-2 gap-2">
              <Button
                className="min-h-11"
                disabled={sending}
                onClick={() => setPicked(null)}
                size="lg"
                type="button"
                variant="secondary"
              >
                Cambiar
              </Button>
              <Button
                aria-busy={sending}
                className="min-h-11"
                disabled={sending}
                onClick={handleSend}
                size="lg"
                type="button"
              >
                {sending ? "Enviando…" : "Enviar"}
              </Button>
            </div>
          </div>
        ) : (
          <>
            <input
              accept={DOCUMENT_FILE_ACCEPT}
              aria-label={`${uploadLabel(row)}: ${row.name}`}
              className="sr-only"
              id={inputId}
              onChange={handlePick}
              ref={inputRef}
              type="file"
            />
            <Button
              className="min-h-11 self-start"
              onClick={() => inputRef.current?.click()}
              size="lg"
              type="button"
              variant={row.status === "missing" ? "primary" : "secondary"}
            >
              {uploadLabel(row)}
            </Button>
          </>
        )
      ) : null}

      {error ? (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      ) : null}
    </li>
  );
};

export const EmployeeDocumentList = ({
  rows,
  state,
  message,
  canUpload,
}: EmployeeDocumentListProps) => (
  <section
    aria-labelledby="mis-documentos"
    className="workia-pass-card flex flex-col gap-3 px-5 py-4"
    data-state={state}
  >
    <h2 className="sr-only" id="mis-documentos">
      Documentos de tu puesto
    </h2>
    <p className="text-sm" role="status">
      {employeeMessage(state, message)}
    </p>
    {rows.length > 0 ? (
      <ul className="divide-border/70 divide-y">
        {rows.map((row) => (
          <DocumentRow
            canUpload={canUpload}
            key={row.requirementId}
            row={row}
          />
        ))}
      </ul>
    ) : null}
  </section>
);
