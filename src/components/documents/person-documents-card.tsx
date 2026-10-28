"use client";

import { useRouter } from "next/navigation";
import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";

import { DetailCard } from "@/components/people/person-detail-card";
import { CompanyField } from "@/components/tenant/company-context";
import { Badge } from "@/components/ui/badge";
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
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { formatDateMx, parseFlexibleDateToIso } from "@/lib/format/date";
import {
  DOCUMENT_STATUS_LABELS,
  PERSON_DOCUMENT_CARD_COPY,
  summarizePersonDocumentRows,
  type PersonDocumentCardView,
  type PersonDocumentRow,
} from "@/lib/documents/person-card";
import { addCalendarMonths, statusOf } from "@/lib/documents/schema";
import { toneFor } from "@/lib/ui/status-tone";

export type RecordDeliveryAction = (
  formData: FormData,
) => Promise<{ ok: true } | { error: string }>;

type PersonDocumentsCardProps = {
  /** "loading" is the skeleton while the expediente is still resolving. */
  view: PersonDocumentCardView | "loading";
  /** False for documents:read without documents:manage, and for a deleted person. */
  canManage?: boolean;
  personId?: string;
  /** Company calendar date, from isoToday(). The chip after a save uses it. */
  today?: string;
  recordAction?: RecordDeliveryAction;
};

const DATE_INVALID = "Usa una fecha día/mes/año.";
const EXPIRES_INVALID = "La fecha de vencimiento no existe.";
const EXPIRES_BEFORE = "La vigencia no puede ser anterior a la entrega.";
const SAVE_FAILED = "No se pudo registrar la entrega.";

const validityHint = (months: number | null) => {
  if (!months) {
    return "El vencimiento es opcional. Vacío significa que no vence.";
  }

  const span = months === 1 ? "1 mes" : `${months} meses`;

  return `El vencimiento se calcula a ${span} de la entrega y puedes cambiarlo.`;
};

const dateLabel = (
  deliveredOn: string | null,
  expiresOn: string | null,
  kind: "delivered" | "expires",
) => {
  if (kind === "delivered") {
    return deliveredOn ? formatDateMx(deliveredOn) : "—";
  }

  if (!deliveredOn) {
    return "—";
  }

  return expiresOn
    ? formatDateMx(expiresOn)
    : PERSON_DOCUMENT_CARD_COPY.noExpiry;
};

const DocumentsSkeleton = () => (
  <div
    aria-busy="true"
    aria-label={PERSON_DOCUMENT_CARD_COPY.loading}
    className="space-y-3"
    data-state="loading"
    data-testid="document-skeleton"
    role="status"
  >
    <Skeleton className="h-4 w-48" />
    <Skeleton className="h-4 w-full" />
    <Skeleton className="h-4 w-2/3" />
  </div>
);

const DateField = ({
  id,
  label,
  value,
  disabled,
  onValue,
}: {
  id: string;
  label: string;
  value: string;
  disabled?: boolean;
  onValue: (display: string, iso: string) => void;
}) => {
  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const display = event.target.value;
    onValue(display, parseFlexibleDateToIso(display) ?? "");
  };

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        autoComplete="off"
        disabled={disabled}
        id={id}
        inputMode="numeric"
        lang="es-MX"
        onChange={handleChange}
        placeholder="dd/mm/aaaa"
        title="Día/mes/año"
        type="text"
        value={value}
      />
    </div>
  );
};

const RegisterDeliveryForm = ({
  personId,
  row,
  action,
  onRecorded,
  onCancel,
}: {
  personId: string;
  row: PersonDocumentRow;
  action: RecordDeliveryAction;
  onRecorded: (deliveredOn: string, expiresOn: string | null) => void;
  onCancel: () => void;
}) => {
  const [deliveredDisplay, setDeliveredDisplay] = useState("");
  const [deliveredIso, setDeliveredIso] = useState("");
  const [expiresDisplay, setExpiresDisplay] = useState("");
  const [expiresIso, setExpiresIso] = useState("");
  const [expiresEdited, setExpiresEdited] = useState(false);
  const [noVence, setNoVence] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;

    return () => {
      mounted.current = false;
    };
  }, []);

  const handleDelivered = (display: string, iso: string) => {
    setDeliveredDisplay(display);
    setDeliveredIso(iso);
    setError(null);

    if (expiresEdited || noVence || !row.validityMonths || !iso) {
      if (!iso && !expiresEdited && !noVence) {
        setExpiresDisplay("");
        setExpiresIso("");
      }

      return;
    }

    const next = addCalendarMonths(iso, row.validityMonths);
    setExpiresIso(next);
    setExpiresDisplay(formatDateMx(next));
  };

  const handleExpires = (display: string, iso: string) => {
    setExpiresEdited(true);
    setExpiresDisplay(display);
    setExpiresIso(iso);
    setError(null);
  };

  const handleNoVence = (checked: boolean) => {
    setNoVence(checked);
    setError(null);

    if (checked) {
      setExpiresDisplay("");
      setExpiresIso("");
      return;
    }

    if (!expiresEdited && deliveredIso && row.validityMonths) {
      const next = addCalendarMonths(deliveredIso, row.validityMonths);
      setExpiresIso(next);
      setExpiresDisplay(formatDateMx(next));
    }
  };

  const storedExpires = () => {
    if (noVence) {
      return null;
    }

    if (expiresIso) {
      return expiresIso;
    }

    if (row.validityMonths && deliveredIso) {
      return addCalendarMonths(deliveredIso, row.validityMonths);
    }

    return null;
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!deliveredIso) {
      setError(DATE_INVALID);
      return;
    }

    if (!noVence && expiresDisplay.trim() && !expiresIso) {
      setError(EXPIRES_INVALID);
      return;
    }

    if (!noVence && expiresIso && expiresIso < deliveredIso) {
      setError(EXPIRES_BEFORE);
      return;
    }

    const data = new FormData(event.currentTarget);
    const expiresOn = storedExpires();
    setPending(true);
    setError(null);

    void action(data)
      .then((result) => {
        if (!mounted.current) {
          if (!("error" in result)) {
            onRecorded(deliveredIso, expiresOn);
          }

          return;
        }

        if ("error" in result) {
          setError(result.error);
          setPending(false);
          return;
        }

        onRecorded(deliveredIso, expiresOn);
      })
      .catch(() => {
        if (!mounted.current) {
          return;
        }

        setError(SAVE_FAILED);
        setPending(false);
      });
  };

  return (
    <form className="space-y-4" noValidate onSubmit={handleSubmit}>
      <CompanyField />
      <input name="personId" type="hidden" value={personId} />
      <input name="requirementId" type="hidden" value={row.requirementId} />
      <input name="deliveredOn" type="hidden" value={deliveredIso} />
      {noVence ? <input name="noVence" type="hidden" value="on" /> : null}
      {!noVence ? (
        <input name="expiresOn" type="hidden" value={expiresIso} />
      ) : null}
      {error ? (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      ) : null}
      <DateField
        id="document-delivered"
        label="Fecha de entrega"
        onValue={handleDelivered}
        value={deliveredDisplay}
      />
      <DateField
        disabled={noVence}
        id="document-expires"
        label="Vencimiento"
        onValue={handleExpires}
        value={expiresDisplay}
      />
      <p className="text-muted-foreground text-xs">
        {validityHint(row.validityMonths)}
      </p>
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor="document-no-vence">No vence</Label>
        <Switch
          checked={noVence}
          id="document-no-vence"
          onCheckedChange={handleNoVence}
        />
      </div>
      <DialogFooter>
        <Button onClick={onCancel} type="button" variant="ghost">
          Cancelar
        </Button>
        <Button
          aria-busy={pending}
          disabled={pending}
          type="submit"
          variant="primary"
        >
          {pending ? "Guardando…" : "Registrar"}
        </Button>
      </DialogFooter>
    </form>
  );
};

const DocumentRow = ({
  row,
  canManage,
  onRegister,
}: {
  row: PersonDocumentRow;
  canManage: boolean;
  onRegister: (requirementId: string) => void;
}) => {
  const handleRegister = () => {
    onRegister(row.requirementId);
  };

  return (
    <li
      className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0"
      data-status={row.status}
      data-testid={`document-row-${row.requirementId}`}
    >
      <div className="flex items-start justify-between gap-3">
        <span className="min-w-0 font-medium break-words">{row.name}</span>
        <Badge tone={toneFor("document", row.status)}>
          {DOCUMENT_STATUS_LABELS[row.status]}
        </Badge>
      </div>
      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="workia-field-label">Entrega</dt>
          <dd>{dateLabel(row.deliveredOn, row.expiresOn, "delivered")}</dd>
        </div>
        <div>
          <dt className="workia-field-label">Vencimiento</dt>
          <dd>{dateLabel(row.deliveredOn, row.expiresOn, "expires")}</dd>
        </div>
      </dl>
      {canManage ? (
        <Button
          aria-haspopup="dialog"
          aria-label={`Registrar entrega de ${row.name}`}
          className="self-start"
          onClick={handleRegister}
          size="sm"
          type="button"
          variant="secondary"
        >
          Registrar entrega
        </Button>
      ) : null}
    </li>
  );
};

const PersonDocumentsBody = ({
  view,
  canManage,
  personId,
  today,
  recordAction,
}: {
  view: PersonDocumentCardView;
  canManage: boolean;
  personId: string;
  today: string;
  recordAction?: RecordDeliveryAction;
}) => {
  const router = useRouter();
  const incoming = JSON.stringify(view.rows);
  const [seen, setSeen] = useState(incoming);
  const [rows, setRows] = useState(view.rows);
  const [openId, setOpenId] = useState<string | null>(null);

  if (incoming !== seen) {
    setSeen(incoming);
    setRows(view.rows);
  }

  const summary =
    view.state === "error"
      ? { state: "error" as const, message: view.message }
      : summarizePersonDocumentRows(rows);
  const active = rows.find((row) => row.requirementId === openId) ?? null;
  const showRegister =
    canManage && Boolean(recordAction) && view.state !== "error";
  const showReadOnly = !showRegister && view.state !== "error";

  const handleOpen = (requirementId: string) => {
    setOpenId(requirementId);
  };

  const handleClose = () => {
    setOpenId(null);
  };

  const handleRecorded = (deliveredOn: string, expiresOn: string | null) => {
    setRows((current) =>
      current.map((row) =>
        row.requirementId === openId
          ? {
              ...row,
              deliveredOn,
              expiresOn,
              status: statusOf(
                { required: row.required },
                { expiresOn },
                today,
              ),
            }
          : row,
      ),
    );
    setOpenId(null);
    router.refresh();
  };

  return (
    <div
      className="space-y-3"
      data-state={summary.state}
      data-testid="person-documents"
    >
      <p
        className="text-sm"
        data-testid="document-message"
        role={summary.state === "error" ? "alert" : "status"}
      >
        {summary.message}
      </p>
      {showReadOnly ? (
        <p
          className="text-muted-foreground text-sm"
          data-testid="documents-readonly"
        >
          {PERSON_DOCUMENT_CARD_COPY.readOnly}
        </p>
      ) : null}
      {rows.length > 0 ? (
        <ul
          aria-label="Documentos del puesto"
          className="divide-border/70 divide-y"
        >
          {rows.map((row) => (
            <DocumentRow
              canManage={showRegister}
              key={row.requirementId}
              onRegister={handleOpen}
              row={row}
            />
          ))}
        </ul>
      ) : null}
      {showRegister && recordAction && active ? (
        <Dialog
          onOpenChange={(next) => {
            if (!next) {
              handleClose();
            }
          }}
          open
        >
          <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Registrar entrega</DialogTitle>
              <DialogDescription>
                Registra la fecha en que se entregó {active.name}.
              </DialogDescription>
            </DialogHeader>
            <RegisterDeliveryForm
              action={recordAction}
              key={active.requirementId}
              onCancel={handleClose}
              onRecorded={handleRecorded}
              personId={personId}
              row={active}
            />
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
};

/**
 * «Documentos» card. One row per requirement of the person's puesto.
 * documents:manage records a date; documents:read is the same list without
 * the dialog. No note, file or document number.
 */
export const PersonDocumentsCard = ({
  view,
  canManage = false,
  personId = "",
  today = "",
  recordAction,
}: PersonDocumentsCardProps) => (
  <DetailCard id="documentos">
    {view === "loading" ? (
      <DocumentsSkeleton />
    ) : (
      <PersonDocumentsBody
        canManage={canManage}
        personId={personId}
        recordAction={recordAction}
        today={today}
        view={view}
      />
    )}
  </DetailCard>
);
