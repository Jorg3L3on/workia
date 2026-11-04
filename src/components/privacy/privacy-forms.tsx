"use client";

import { useState, type FormEvent, type ReactNode } from "react";

import { ManagerPicker } from "@/components/people/manager-picker";
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
import { Textarea } from "@/components/ui/textarea";
import { ARCO_KINDS } from "@/lib/db/schema/privacy";
import { parseFlexibleDateToIso } from "@/lib/format/date";
import { searchPrivacyPeopleAction } from "@/lib/privacy/actions";
import {
  ARCO_DETAIL_MAX_LENGTH,
  ARCO_RESPONSE_MAX_LENGTH,
  arcoKindLabels,
  PRIVACY_NOTICE_MAX_LENGTH,
  type PrivacyActionState,
} from "@/lib/privacy/schema";

export type PrivacyFormAction = (
  state: PrivacyActionState,
  formData: FormData,
) => Promise<PrivacyActionState>;

/** Submits to a server action and keeps its answer; resets the form on success. */
const useActionForm = (action: PrivacyFormAction, onDone?: () => void) => {
  const [state, setState] = useState<PrivacyActionState>({});
  const [pending, setPending] = useState(false);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);

    setPending(true);
    setState({});

    try {
      const next = await action({}, data);

      setState(next);

      if (next.ok) {
        form.reset();
        onDone?.();
      }
    } finally {
      setPending(false);
    }
  };

  return { state, pending, onSubmit };
};

const FormMessage = ({ state }: { state: PrivacyActionState }) =>
  state.error ? (
    <p className="text-destructive text-sm" role="alert">
      {state.error}
    </p>
  ) : state.message ? (
    <p className="text-sm" role="status">
      {state.message}
    </p>
  ) : null;

const SubmitButton = ({
  pending,
  children,
}: {
  pending: boolean;
  children: ReactNode;
}) => (
  <Button aria-busy={pending} disabled={pending} type="submit">
    {pending ? "Guardando…" : children}
  </Button>
);

/** A new version of the notice. Starts from the text in force. */
export const PublishNoticeForm = ({
  currentBody,
  action,
}: {
  currentBody: string | null;
  action: PrivacyFormAction;
}) => {
  const { state, pending, onSubmit } = useActionForm(action);

  return (
    <form className="space-y-3" noValidate onSubmit={onSubmit}>
      <CompanyField />
      <div className="space-y-1.5">
        <Label htmlFor="privacy-notice-body">
          {currentBody ? "Texto de la nueva versión" : "Texto del aviso"}
        </Label>
        <Textarea
          className="min-h-48 font-mono text-xs"
          defaultValue={currentBody ?? ""}
          id="privacy-notice-body"
          maxLength={PRIVACY_NOTICE_MAX_LENGTH}
          name="body"
        />
        <p className="text-muted-foreground text-xs">
          Publicar crea una versión nueva. Cada persona acepta la versión
          vigente al entrar a la app; las aceptaciones anteriores se conservan.
        </p>
      </div>
      <FormMessage state={state} />
      <SubmitButton pending={pending}>Publicar versión</SubmitButton>
    </form>
  );
};

/** HR records a paper acceptance of the version in force. */
export const RecordAcceptanceForm = ({
  noticeId,
  version,
  action,
}: {
  noticeId: string;
  version: number;
  action: PrivacyFormAction;
}) => {
  const [key, setKey] = useState(0);
  const { state, pending, onSubmit } = useActionForm(action, () =>
    setKey((value) => value + 1),
  );

  return (
    <form className="space-y-3" noValidate onSubmit={onSubmit}>
      <CompanyField />
      <input name="noticeId" type="hidden" value={noticeId} />
      <div className="space-y-1.5">
        <Label htmlFor="privacy-acceptance-person">
          Persona que firmó la versión {version} en papel
        </Label>
        <ManagerPicker
          id="privacy-acceptance-person"
          initial={null}
          key={key}
          name="personId"
          placeholder="Busca por nombre o CURP"
          search={searchPrivacyPeopleAction}
          selectedPrefix="Persona"
        />
      </div>
      <FormMessage state={state} />
      <SubmitButton pending={pending}>Registrar aceptación</SubmitButton>
    </form>
  );
};

const kindOptions = ARCO_KINDS.map((kind) => ({
  value: kind,
  label: arcoKindLabels[kind],
}));

/** An ARCO request received by email, on paper or in person. */
export const CreateArcoRequestForm = ({
  action,
  today,
}: {
  action: PrivacyFormAction;
  today: string;
}) => {
  const [key, setKey] = useState(0);
  const [receivedIso, setReceivedIso] = useState(today);
  const [receivedText, setReceivedText] = useState(
    today.split("-").reverse().join("/"),
  );
  const { state, pending, onSubmit } = useActionForm(action, () =>
    setKey((value) => value + 1),
  );

  return (
    <form className="space-y-3" key={key} noValidate onSubmit={onSubmit}>
      <CompanyField />
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="arco-person">Persona</Label>
          <ManagerPicker
            id="arco-person"
            initial={null}
            name="personId"
            placeholder="Busca por nombre o CURP"
            search={searchPrivacyPeopleAction}
            selectedPrefix="Persona"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="arco-kind">Tipo</Label>
          <FormSelect
            defaultValue="access"
            id="arco-kind"
            name="kind"
            options={kindOptions}
            variant="field"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="arco-received">Recibida el</Label>
          <input name="receivedOn" type="hidden" value={receivedIso} />
          <Input
            autoComplete="off"
            id="arco-received"
            inputMode="numeric"
            lang="es-MX"
            onChange={(event) => {
              setReceivedText(event.target.value);
              setReceivedIso(parseFlexibleDateToIso(event.target.value) ?? "");
            }}
            placeholder="dd/mm/aaaa"
            value={receivedText}
          />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="arco-detail">Qué pide la persona</Label>
        <Textarea
          id="arco-detail"
          maxLength={ARCO_DETAIL_MAX_LENGTH}
          name="detail"
        />
      </div>
      <FormMessage state={state} />
      <SubmitButton pending={pending}>Registrar solicitud</SubmitButton>
    </form>
  );
};

/** Closes one open request with the answer given to the person. */
export const ResolveArcoRequestButton = ({
  requestId,
  personName,
  action,
}: {
  requestId: string;
  personName: string;
  action: PrivacyFormAction;
}) => {
  const [open, setOpen] = useState(false);
  const [outcome, setOutcome] = useState<"resolved" | "rejected">("resolved");
  const { state, pending, onSubmit } = useActionForm(action, () =>
    setOpen(false),
  );

  return (
    <>
      <Button onClick={() => setOpen(true)} size="sm" variant="secondary">
        Cerrar
      </Button>
      <Dialog onOpenChange={setOpen} open={open}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cerrar solicitud</DialogTitle>
            <DialogDescription>
              Solicitud de {personName}. Guarda la respuesta que se le dio.
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-3" noValidate onSubmit={onSubmit}>
            <CompanyField />
            <input name="requestId" type="hidden" value={requestId} />
            <input name="outcome" type="hidden" value={outcome} />
            <div className="space-y-1.5">
              <Label htmlFor={`arco-outcome-${requestId}`}>Resultado</Label>
              <FormSelect
                id={`arco-outcome-${requestId}`}
                onValueChange={(value) =>
                  setOutcome(value === "rejected" ? "rejected" : "resolved")
                }
                options={[
                  { value: "resolved", label: "Atendida" },
                  { value: "rejected", label: "Improcedente" },
                ]}
                value={outcome}
                variant="field"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`arco-response-${requestId}`}>Respuesta</Label>
              <Textarea
                id={`arco-response-${requestId}`}
                maxLength={ARCO_RESPONSE_MAX_LENGTH}
                name="response"
              />
            </div>
            <FormMessage state={state} />
            <DialogFooter>
              <Button
                onClick={() => setOpen(false)}
                type="button"
                variant="ghost"
              >
                Cancelar
              </Button>
              <SubmitButton pending={pending}>Cerrar solicitud</SubmitButton>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
};
