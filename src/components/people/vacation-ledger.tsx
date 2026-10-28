"use client";

import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";

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
import { Textarea } from "@/components/ui/textarea";
import { formatDateMx, parseFlexibleDateToIso } from "@/lib/format/date";
import {
  VACATION_COPY,
  formatVacationDays,
  previewVacationRegistration,
} from "@/lib/vacations/balance";
import type {
  VacationActionState,
  VacationHistoryItem,
  VacationPeriodSlice,
  VacationSpan,
} from "@/lib/vacations/types";

/**
 * Registrar vacaciones and the history list (WRK-I14-3).
 * pendiente de contador: the form asks for the number of days. It does not
 * count working days from the calendar range, and it does not drop a rest
 * day from the schedule. Half days are 0.5 steps. There is no control that
 * pays instead of resting.
 */

export type VacationFormAction = (
  state: VacationActionState,
  formData: FormData,
) => Promise<VacationActionState>;

export type VacationLedgerModel = {
  showHistory: boolean;
  records: VacationHistoryItem[];
  existing: VacationSpan[];
  canCreate: boolean;
  canVoid: boolean;
  personId: string;
  periods: VacationPeriodSlice[];
  fallbackFechaIngreso: string | null;
  registerAction: VacationFormAction;
  voidAction: VacationFormAction;
};

const historyState = (count: number) => {
  if (count === 0) {
    return "empty";
  }

  if (count === 1) {
    return "one";
  }

  return "many";
};

const DateField = ({
  id,
  name,
  label,
  onIso,
}: {
  id: string;
  name: string;
  label: string;
  onIso: (iso: string) => void;
}) => {
  const [iso, setIso] = useState("");
  const [display, setDisplay] = useState("");

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const next = event.target.value;
    const parsed = parseFlexibleDateToIso(next) ?? "";

    setDisplay(next);
    setIso(parsed);
    onIso(parsed);
  };

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <input name={name} type="hidden" value={iso} />
      <Input
        autoComplete="off"
        id={id}
        inputMode="numeric"
        lang="es-MX"
        onChange={handleChange}
        placeholder="dd/mm/aaaa"
        title="Día/mes/año"
        type="text"
        value={display}
      />
    </div>
  );
};

const RegisterVacationForm = ({
  personId,
  periods,
  fallbackFechaIngreso,
  existing,
  action,
  onSaved,
}: {
  personId: string;
  periods: VacationPeriodSlice[];
  fallbackFechaIngreso: string | null;
  existing: VacationSpan[];
  action: VacationFormAction;
  onSaved: () => void;
}) => {
  const [startIso, setStartIso] = useState("");
  const [endIso, setEndIso] = useState("");
  const [daysText, setDaysText] = useState("");
  const [noteText, setNoteText] = useState("");
  const [state, setState] = useState<VacationActionState>({});
  const [pending, setPending] = useState(false);

  const preview = previewVacationRegistration({
    periods,
    fallbackFechaIngreso,
    startDate: startIso,
    endDate: endIso,
    days: daysText,
    note: noteText,
    existing,
  });
  const warning = preview.ok ? preview.warning : null;

  useEffect(() => {
    if (state.ok) {
      onSaved();
    }
  }, [onSaved, state.ok]);

  const handleAction = async (formData: FormData) => {
    const next = previewVacationRegistration({
      periods,
      fallbackFechaIngreso,
      startDate: String(formData.get("startDate") ?? ""),
      endDate: String(formData.get("endDate") ?? ""),
      days: String(formData.get("days") ?? ""),
      note: String(formData.get("note") ?? ""),
      existing,
    });

    if (!next.ok) {
      setState({ error: next.error });
      return;
    }

    setPending(true);
    setState({});

    try {
      setState(await action({}, formData));
    } finally {
      setPending(false);
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void handleAction(data);
  };

  const handleDaysChange = (event: ChangeEvent<HTMLInputElement>) => {
    setDaysText(event.target.value);
    setState({});
  };

  const handleNoteChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    setNoteText(event.target.value);
  };

  return (
    <form className="space-y-4" noValidate onSubmit={handleSubmit}>
      <CompanyField />
      <input name="personId" type="hidden" value={personId} />
      {state.error ? (
        <p className="text-destructive text-sm" role="alert">
          {state.error}
        </p>
      ) : null}
      {warning ? (
        <p
          className="text-sm"
          data-testid="vacation-dialog-warning"
          role="status"
        >
          {warning}
        </p>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <DateField
          id="vacation-start"
          label="Inicio"
          name="startDate"
          onIso={setStartIso}
        />
        <DateField
          id="vacation-end"
          label="Fin"
          name="endDate"
          onIso={setEndIso}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="vacation-days-input">Días</Label>
        <Input
          id="vacation-days-input"
          inputMode="decimal"
          name="days"
          onChange={handleDaysChange}
          value={daysText}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="vacation-note">Nota (opcional)</Label>
        <Textarea
          id="vacation-note"
          maxLength={280}
          name="note"
          onChange={handleNoteChange}
          value={noteText}
        />
      </div>
      <DialogFooter>
        <Button onClick={onSaved} type="button" variant="ghost">
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

const VoidVacationButton = ({
  action,
  personId,
  record,
}: {
  action: VacationFormAction;
  personId: string;
  record: VacationHistoryItem;
}) => {
  const [state, setState] = useState<VacationActionState>({});
  const [pending, setPending] = useState(false);
  const range = `${formatDateMx(record.startDate)} al ${formatDateMx(record.endDate)}`;

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);

    setPending(true);
    setState({});
    void action({}, data)
      .then((next) => setState(next))
      .finally(() => setPending(false));
  };

  return (
    <form className="shrink-0" onSubmit={handleSubmit}>
      <CompanyField />
      <input name="personId" type="hidden" value={personId} />
      <input name="recordId" type="hidden" value={record.id} />
      {state.error ? (
        <p className="text-destructive text-xs" role="alert">
          {state.error}
        </p>
      ) : null}
      <Button
        aria-busy={pending}
        aria-label={`Anular vacaciones del ${range}`}
        disabled={pending}
        size="sm"
        type="submit"
        variant="ghost"
      >
        {pending ? "Anulando…" : "Anular"}
      </Button>
    </form>
  );
};

const VacationHistory = ({
  records,
  canVoid,
  personId,
  voidAction,
}: {
  records: VacationHistoryItem[];
  canVoid: boolean;
  personId: string;
  voidAction: VacationFormAction;
}) => (
  <div className="space-y-2" data-history={historyState(records.length)}>
    <p className="workia-field-label">Historial</p>
    {records.length === 0 ? (
      <p className="text-muted-foreground text-sm" role="status">
        {VACATION_COPY.emptyHistory}
      </p>
    ) : (
      <ul aria-label="Historial de vacaciones" className="space-y-2">
        {records.map((record) => {
          const parts = [
            `${formatDateMx(record.startDate)} al ${formatDateMx(record.endDate)}`,
            formatVacationDays(record.days),
            record.serviceYear > 0 ? `año ${record.serviceYear}` : null,
            record.createdByName,
          ].filter((part): part is string => Boolean(part));

          return (
            <li
              className="flex items-start justify-between gap-3 text-sm"
              data-testid="vacation-history-item"
              key={record.id}
            >
              <div className="min-w-0">
                <p className="break-words">{parts.join(" · ")}</p>
                {record.note ? (
                  <p className="text-muted-foreground text-xs break-words">
                    {record.note}
                  </p>
                ) : null}
              </div>
              {canVoid ? (
                <VoidVacationButton
                  action={voidAction}
                  personId={personId}
                  record={record}
                />
              ) : null}
            </li>
          );
        })}
      </ul>
    )}
  </div>
);

export const VacationLedger = ({
  showHistory,
  records,
  existing,
  canCreate,
  canVoid,
  personId,
  periods,
  fallbackFechaIngreso,
  registerAction,
  voidAction,
}: VacationLedgerModel) => {
  const [open, setOpen] = useState(false);
  const [formKey, setFormKey] = useState(0);

  const handleOpenChange = (next: boolean) => {
    if (next) {
      setFormKey((current) => current + 1);
    }

    setOpen(next);
  };

  const handleOpen = () => {
    handleOpenChange(true);
  };

  const handleClose = () => {
    setOpen(false);
  };

  return (
    <div className="space-y-3">
      {canCreate ? (
        <Button
          aria-expanded={open}
          aria-haspopup="dialog"
          onClick={handleOpen}
          type="button"
          variant="secondary"
        >
          Registrar vacaciones
        </Button>
      ) : null}
      {canCreate ? (
        <Dialog onOpenChange={handleOpenChange} open={open}>
          <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Registrar vacaciones</DialogTitle>
              <DialogDescription>
                Indica el periodo y los días que se tomaron. Los días se
                capturan a mano, en medios días.
              </DialogDescription>
            </DialogHeader>
            <RegisterVacationForm
              action={registerAction}
              existing={existing}
              fallbackFechaIngreso={fallbackFechaIngreso}
              key={formKey}
              onSaved={handleClose}
              periods={periods}
              personId={personId}
            />
          </DialogContent>
        </Dialog>
      ) : null}
      {showHistory ? (
        <VacationHistory
          canVoid={canVoid}
          personId={personId}
          records={records}
          voidAction={voidAction}
        />
      ) : null}
    </div>
  );
};
