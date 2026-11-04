"use client";

import { unzip, type Unzipped } from "fflate";
import { UploadIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent, type ReactNode } from "react";

import { ManagerPicker } from "@/components/people/manager-picker";
import {
  CompanyField,
  useActiveCompany,
} from "@/components/tenant/company-context";
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
import { parseCfdiNomina } from "@/lib/payroll/cfdi";
import { pairReceiptFiles, type ReceiptPair } from "@/lib/payroll/pairing";
import {
  RECEIPT_PDF_MAX_BYTES,
  RECEIPT_UPLOAD_CONCURRENCY,
  RECEIPT_ZIP_MAX_BYTES,
  suggestedPeriodLabel,
  type PayrollActionState,
} from "@/lib/payroll/schema";
import { searchPayrollPeopleAction } from "@/lib/payroll/actions";
import { COMPANY_FIELD } from "@/lib/tenant/scope";

export type PayrollFormAction = (
  state: PayrollActionState,
  formData: FormData,
) => Promise<PayrollActionState>;

const FormMessage = ({ state }: { state: PayrollActionState }) =>
  state.error ? (
    <p className="text-destructive text-sm" role="alert">
      {state.error}
    </p>
  ) : state.message ? (
    <p className="text-sm" role="status">
      {state.message}
    </p>
  ) : null;

/** Submits to a server action and keeps its answer. */
const useActionForm = (
  action: PayrollFormAction,
  onDone?: (state: PayrollActionState) => void,
) => {
  const [state, setState] = useState<PayrollActionState>({});
  const [pending, setPending] = useState(false);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);

    setPending(true);
    setState({});

    try {
      const next = await action({}, data);

      setState(next);

      if (next.ok) {
        onDone?.(next);
      }
    } finally {
      setPending(false);
    }
  };

  return { state, pending, onSubmit };
};

const unzipFile = (bytes: Uint8Array) =>
  new Promise<Unzipped>((resolve, reject) => {
    unzip(bytes, (error, files) => (error ? reject(error) : resolve(files)));
  });

type Entry = { path: string; size: number; bytes: Uint8Array };

type Prepared = {
  fileName: string;
  pairs: ReceiptPair<Entry>[];
  orphanPdfs: string[];
  withoutPdf: number;
  periodStart: string;
  periodEnd: string;
};

type Outcome = "matched" | "unmatched" | "duplicate" | "invalid";

type Progress = {
  done: number;
  total: number;
  counts: Record<Outcome, number>;
  errors: { name: string; error: string }[];
};

/** The dates most receipts in the zip carry, for the period form. */
const commonDates = (pairs: ReceiptPair<Entry>[]) => {
  const tally = new Map<string, number>();
  const decoder = new TextDecoder();

  for (const pair of pairs) {
    const parsed = parseCfdiNomina(decoder.decode(pair.xml.bytes));

    if (parsed.ok && parsed.value.periodStart && parsed.value.periodEnd) {
      const key = `${parsed.value.periodStart}|${parsed.value.periodEnd}`;
      tally.set(key, (tally.get(key) ?? 0) + 1);
    }
  }

  const [best] = [...tally.entries()].sort((a, b) => b[1] - a[1]);
  const [periodStart = "", periodEnd = ""] = best?.[0].split("|") ?? [];

  return { periodStart, periodEnd };
};

const uploadOne = async (
  periodId: string,
  pair: ReceiptPair<Entry>,
): Promise<{ status: Outcome; error?: string }> => {
  const body = new FormData();

  body.set(
    "xml",
    new Blob([pair.xml.bytes as Uint8Array<ArrayBuffer>], {
      type: "application/xml",
    }),
    `${pair.name}.xml`,
  );

  if (pair.pdf) {
    body.set(
      "pdf",
      new Blob([pair.pdf.bytes as Uint8Array<ArrayBuffer>], {
        type: "application/pdf",
      }),
      `${pair.name}.pdf`,
    );
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(`/api/nomina/periodos/${periodId}/recibos`, {
        method: "POST",
        body,
      });
      const json = (await response.json().catch(() => ({}))) as {
        status?: Outcome;
        error?: string;
      };

      if (response.ok && json.status) {
        return { status: json.status };
      }

      if (response.status === 422) {
        return { status: "invalid", error: json.error };
      }

      if (response.status < 500) {
        return { status: "invalid", error: json.error ?? "No se pudo subir." };
      }
    } catch {
      // Network hiccup: retry below.
    }

    await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
  }

  return { status: "invalid", error: "No se pudo subir; vuelve a intentar." };
};

/**
 * Import of one period's receipts (W2-03): HR picks the provider's zip, the
 * browser unzips it and pairs each XML with its PDF, then uploads one receipt
 * per request (a few at a time). Without `periodId` it first creates the
 * period from the dates most receipts carry; with one it adds to that period,
 * so an interrupted import can be resumed (CFDI already in are skipped).
 */
export const ImportReceiptsDialog = ({
  createAction,
  finishAction,
  periodId: existingPeriodId,
  triggerLabel = "Importar recibos",
  disabled = false,
}: {
  createAction: PayrollFormAction;
  finishAction: PayrollFormAction;
  periodId?: string;
  triggerLabel?: string;
  disabled?: boolean;
}) => {
  const router = useRouter();
  const company = useActiveCompany();
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [reading, setReading] = useState(false);
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [state, setState] = useState<PayrollActionState>({});

  const reset = () => {
    setPrepared(null);
    setProgress(null);
    setState({});

    if (inputRef.current) {
      inputRef.current.value = "";
    }
  };

  const onFile = async (file: File | undefined) => {
    reset();

    if (!file) {
      return;
    }

    if (file.size > RECEIPT_ZIP_MAX_BYTES) {
      setState({ error: "El zip pesa más de 400 MB." });
      return;
    }

    setReading(true);

    try {
      const files = await unzipFile(new Uint8Array(await file.arrayBuffer()));
      const entries: Entry[] = Object.entries(files).map(([path, bytes]) => ({
        path,
        size: bytes.byteLength,
        bytes,
      }));
      const { pairs, orphanPdfs } = pairReceiptFiles(entries);

      if (pairs.length === 0) {
        setState({ error: "El zip no trae ningún XML de CFDI." });
        return;
      }

      setPrepared({
        fileName: file.name,
        pairs,
        orphanPdfs: orphanPdfs.map((entry) => entry.path),
        withoutPdf: pairs.filter((pair) => !pair.pdf).length,
        ...commonDates(pairs),
      });
    } catch {
      setState({ error: "No se pudo abrir el zip." });
    } finally {
      setReading(false);
    }
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!prepared) {
      return;
    }

    setState({});
    let periodId = existingPeriodId;

    if (!periodId) {
      const created = await createAction({}, new FormData(event.currentTarget));

      if (!created.ok || !created.periodId) {
        setState(created);
        return;
      }

      periodId = created.periodId;
    }

    const queue = [...prepared.pairs];
    const current: Progress = {
      done: 0,
      total: queue.length,
      counts: { matched: 0, unmatched: 0, duplicate: 0, invalid: 0 },
      errors: [],
    };

    setProgress({ ...current });

    const worker = async () => {
      for (let pair = queue.shift(); pair; pair = queue.shift()) {
        const tooLarge = pair.pdf && pair.pdf.size > RECEIPT_PDF_MAX_BYTES;
        const outcome = tooLarge
          ? { status: "invalid" as const, error: "El PDF pesa más de 3 MB." }
          : await uploadOne(periodId!, pair);

        current.done += 1;
        current.counts[outcome.status] += 1;

        if (outcome.status === "invalid") {
          current.errors.push({
            name: pair.name,
            error: outcome.error ?? "Inválido.",
          });
        }

        setProgress({ ...current, errors: [...current.errors] });
      }
    };

    await Promise.all(
      Array.from({ length: RECEIPT_UPLOAD_CONCURRENCY }, () => worker()),
    );

    const summary = new FormData();

    summary.set("periodId", periodId);
    if (company) {
      summary.set(COMPANY_FIELD, company.id);
    }
    for (const [key, value] of Object.entries(current.counts)) {
      summary.set(key, String(value));
    }

    await finishAction({}, summary);

    if (current.errors.length === 0) {
      setOpen(false);
      reset();
    }

    router.push(`/app/nomina/${periodId}`);
    router.refresh();
  };

  const uploading = progress !== null && progress.done < progress.total;
  const finished = progress !== null && progress.done === progress.total;

  return (
    <>
      <Button disabled={disabled} onClick={() => setOpen(true)}>
        <UploadIcon aria-hidden />
        {triggerLabel}
      </Button>
      <Dialog
        onOpenChange={(next) => {
          if (!uploading) {
            setOpen(next);
            if (!next) reset();
          }
        }}
        open={open}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{triggerLabel}</DialogTitle>
            <DialogDescription>
              El zip del proveedor de nómina con el XML y el PDF de cada recibo.
              Cada recibo se asigna por CURP, número de empleado o RFC.
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" noValidate onSubmit={onSubmit}>
            <CompanyField />
            <div className="space-y-1.5">
              <Label htmlFor="payroll-zip">Archivo zip</Label>
              <Input
                accept=".zip,application/zip"
                disabled={reading || uploading}
                id="payroll-zip"
                onChange={(event) => onFile(event.target.files?.[0])}
                ref={inputRef}
                type="file"
              />
              {reading ? (
                <p className="text-muted-foreground text-sm" role="status">
                  Leyendo el zip…
                </p>
              ) : null}
            </div>

            {prepared ? (
              <div className="space-y-3">
                <p className="text-sm" data-testid="payroll-zip-summary">
                  {prepared.pairs.length}{" "}
                  {prepared.pairs.length === 1 ? "recibo" : "recibos"}
                  {prepared.withoutPdf > 0
                    ? `, ${prepared.withoutPdf} sin PDF`
                    : ""}
                  {prepared.orphanPdfs.length > 0
                    ? `, ${prepared.orphanPdfs.length} PDF sin XML (no se importan)`
                    : ""}
                  .
                </p>
                {existingPeriodId ? null : (
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="space-y-1.5 sm:col-span-3">
                      <Label htmlFor="payroll-label">Periodo</Label>
                      <Input
                        defaultValue={
                          prepared.periodEnd
                            ? suggestedPeriodLabel(prepared.periodEnd)
                            : ""
                        }
                        id="payroll-label"
                        key={`label-${prepared.fileName}`}
                        maxLength={80}
                        name="label"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="payroll-start">Del</Label>
                      <Input
                        defaultValue={prepared.periodStart}
                        id="payroll-start"
                        key={`start-${prepared.fileName}`}
                        name="periodStart"
                        type="date"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="payroll-end">Al</Label>
                      <Input
                        defaultValue={prepared.periodEnd}
                        id="payroll-end"
                        key={`end-${prepared.fileName}`}
                        name="periodEnd"
                        type="date"
                      />
                    </div>
                  </div>
                )}
              </div>
            ) : null}

            {progress ? (
              <div className="space-y-2" role="status">
                <div
                  aria-label="Avance de la importación"
                  aria-valuemax={progress.total}
                  aria-valuemin={0}
                  aria-valuenow={progress.done}
                  className="bg-muted h-2 overflow-hidden rounded-full"
                  role="progressbar"
                >
                  <div
                    className="bg-primary h-full transition-[width]"
                    style={{
                      width: `${Math.round((progress.done * 100) / Math.max(progress.total, 1))}%`,
                    }}
                  />
                </div>
                <p className="text-sm">
                  {progress.done} de {progress.total}: {progress.counts.matched}{" "}
                  asignados, {progress.counts.unmatched} sin asignar,{" "}
                  {progress.counts.duplicate} ya estaban,{" "}
                  {progress.counts.invalid} con error.
                </p>
                {finished && progress.errors.length > 0 ? (
                  <ul className="text-destructive max-h-32 overflow-y-auto text-xs">
                    {progress.errors.map((item) => (
                      <li key={item.name}>
                        {item.name}: {item.error}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}

            <FormMessage state={state} />
            <DialogFooter>
              <Button
                disabled={uploading}
                onClick={() => {
                  setOpen(false);
                  reset();
                }}
                type="button"
                variant="ghost"
              >
                {finished ? "Cerrar" : "Cancelar"}
              </Button>
              {finished ? null : (
                <Button
                  aria-busy={uploading}
                  disabled={!prepared || uploading}
                  type="submit"
                >
                  {uploading ? "Subiendo…" : "Importar"}
                </Button>
              )}
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
};

const ConfirmForm = ({
  action,
  periodId,
  title,
  description,
  trigger,
  confirmLabel,
  destructive = false,
}: {
  action: PayrollFormAction;
  periodId: string;
  title: string;
  description: ReactNode;
  trigger: string;
  confirmLabel: string;
  destructive?: boolean;
}) => {
  const [open, setOpen] = useState(false);
  const { state, pending, onSubmit } = useActionForm(action, () =>
    setOpen(false),
  );

  return (
    <>
      <Button
        onClick={() => setOpen(true)}
        variant={destructive ? "ghost" : "primary"}
      >
        {trigger}
      </Button>
      {state.ok && state.message ? (
        <p className="text-sm" role="status">
          {state.message}
        </p>
      ) : null}
      <Dialog onOpenChange={setOpen} open={open}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <form className="space-y-3" noValidate onSubmit={onSubmit}>
            <CompanyField />
            <input name="periodId" type="hidden" value={periodId} />
            <FormMessage state={state} />
            <DialogFooter>
              <Button
                onClick={() => setOpen(false)}
                type="button"
                variant="ghost"
              >
                Cancelar
              </Button>
              <Button
                aria-busy={pending}
                disabled={pending}
                type="submit"
                variant={destructive ? "destructive" : "primary"}
              >
                {pending ? "Guardando…" : confirmLabel}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
};

export const PublishPeriodButton = ({
  action,
  periodId,
  matched,
  unmatched,
}: {
  action: PayrollFormAction;
  periodId: string;
  matched: number;
  unmatched: number;
}) => (
  <ConfirmForm
    action={action}
    confirmLabel="Publicar"
    description={`${matched} ${matched === 1 ? "recibo se entrega" : "recibos se entregan"} ahora y cada persona con cuenta recibe un correo.${unmatched > 0 ? ` ${unmatched} sin asignar se entregan cuando los asignes.` : ""}`}
    periodId={periodId}
    title="Publicar periodo"
    trigger="Publicar"
  />
);

export const DiscardPeriodButton = ({
  action,
  periodId,
}: {
  action: PayrollFormAction;
  periodId: string;
}) => (
  <ConfirmForm
    action={action}
    confirmLabel="Descartar"
    description="Se borran el periodo, sus recibos y sus archivos. Úsalo si subiste el zip equivocado."
    destructive
    periodId={periodId}
    title="Descartar importación"
    trigger="Descartar"
  />
);

/** Matches one unmatched receipt to a person. */
export const AssignReceiptForm = ({
  action,
  receiptId,
  periodId,
}: {
  action: PayrollFormAction;
  receiptId: string;
  periodId: string;
}) => {
  const [key, setKey] = useState(0);
  const { state, pending, onSubmit } = useActionForm(action, () =>
    setKey((value) => value + 1),
  );

  return (
    <form className="flex flex-col gap-2" noValidate onSubmit={onSubmit}>
      <CompanyField />
      <input name="receiptId" type="hidden" value={receiptId} />
      <input name="periodId" type="hidden" value={periodId} />
      <ManagerPicker
        id={`payroll-assign-${receiptId}`}
        initial={null}
        key={key}
        name="personId"
        placeholder="Busca por nombre o CURP"
        search={searchPayrollPeopleAction}
        selectedPrefix="Persona"
      />
      <div>
        <Button
          aria-busy={pending}
          disabled={pending}
          size="sm"
          type="submit"
          variant="secondary"
        >
          {pending ? "Guardando…" : "Asignar"}
        </Button>
      </div>
      <FormMessage state={state} />
    </form>
  );
};
