"use client";

import { BanIcon, PlusIcon, RotateCcwIcon } from "lucide-react";
import { useActionState, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { FormSheet } from "@/components/layout/form-sheet";
import { Button } from "@/components/ui/button";
import { RowMenu } from "@/components/ui/data-table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  createCompanyAction,
  setCompanyStatusAction,
  updateCompanyAction,
} from "@/lib/tenant/admin-actions";

type CompanyValues = {
  id: string;
  name: string;
  slug: string;
  legalName: string | null;
  rfc: string | null;
};

const CompanyFields = ({ company }: { company?: CompanyValues }) => (
  <>
    <div className="space-y-2">
      <Label htmlFor="company-name">Nombre comercial</Label>
      <Input
        id="company-name"
        name="name"
        defaultValue={company?.name}
        required
      />
    </div>
    <div className="space-y-2">
      <Label htmlFor="company-slug">
        Identificador{" "}
        <span className="text-muted-foreground font-normal">(opcional)</span>
      </Label>
      <Input
        id="company-slug"
        name="slug"
        defaultValue={company?.slug}
        placeholder="Se genera del nombre si lo dejas vacío"
        pattern="[a-z0-9]+(-[a-z0-9]+)*"
      />
    </div>
    <div className="space-y-2">
      <Label htmlFor="company-legal-name">
        Razón social{" "}
        <span className="text-muted-foreground font-normal">(opcional)</span>
      </Label>
      <Input
        id="company-legal-name"
        name="legalName"
        defaultValue={company?.legalName ?? ""}
      />
    </div>
    <div className="space-y-2">
      <Label htmlFor="company-rfc">
        RFC de la empresa{" "}
        <span className="text-muted-foreground font-normal">(opcional)</span>
      </Label>
      <Input
        id="company-rfc"
        name="rfc"
        defaultValue={company?.rfc ?? ""}
        maxLength={13}
      />
    </div>
  </>
);

/** Edit a company. Platform admins only. */
export const CompanyForm = ({ company }: { company: CompanyValues }) => {
  const [state, action, pending] = useActionState(updateCompanyAction, {});
  const last = useRef(state);

  useEffect(() => {
    if (state === last.current) return;
    last.current = state;
    if (state.ok) toast.success("Empresa guardada.");
  }, [state]);

  return (
    <form
      action={action}
      className="grid gap-3 sm:grid-cols-2"
      id="company-form"
    >
      <input type="hidden" name="targetCompanyId" value={company.id} />
      <CompanyFields company={company} />
      <div className="flex items-center gap-3 sm:col-span-2">
        <Button type="submit" disabled={pending} variant="secondary">
          {pending ? "Guardando…" : "Guardar cambios"}
        </Button>
        {state.error ? (
          <p role="alert" className="text-destructive text-sm">
            {state.error}
          </p>
        ) : null}
      </div>
    </form>
  );
};

/** «Nueva empresa»: the header's primary, opening a Sheet; success opens the company. */
export const NewCompanySheet = () => {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(createCompanyAction, {});

  return (
    <FormSheet
      description="Después de crearla, agrega a su primera persona administradora."
      formId="new-company-form"
      onOpenChange={setOpen}
      open={open}
      pending={pending}
      submitLabel="Crear empresa"
      title="Nueva empresa"
      triggerIcon={PlusIcon}
      triggerLabel="Nueva empresa"
    >
      <form action={action} className="space-y-4" id="new-company-form">
        <CompanyFields />
        {state.error ? (
          <p role="alert" className="text-destructive text-sm">
            {state.error}
          </p>
        ) : null}
      </form>
    </FormSheet>
  );
};

/** ⋯ of a company: suspend (behind a confirmation) or reactivate. */
export const CompanyStatusMenu = ({
  companyId,
  companyName,
  status,
}: {
  companyId: string;
  companyName: string;
  status: "activa" | "suspendida";
}) => {
  const [state, action] = useActionState(setCompanyStatusAction, {});
  const last = useRef(state);
  const next = status === "activa" ? "suspendida" : "activa";

  useEffect(() => {
    if (state === last.current) return;
    last.current = state;
    if (state.error) toast.error(state.error);
    if (state.ok) toast.success("Estado de la empresa actualizado.");
  }, [state]);

  return (
    <RowMenu
      actions={[
        {
          label:
            next === "suspendida" ? "Suspender empresa" : "Reactivar empresa",
          icon: next === "suspendida" ? BanIcon : RotateCcwIcon,
          destructive: next === "suspendida",
          action,
          fields: (
            <>
              <input type="hidden" name="targetCompanyId" value={companyId} />
              <input type="hidden" name="status" value={next} />
            </>
          ),
          confirm:
            next === "suspendida"
              ? {
                  title: `¿Suspender ${companyName}?`,
                  description:
                    "Sus miembros dejan de entrar hasta que la reactives. Los datos se conservan.",
                  confirmLabel: "Suspender empresa",
                }
              : undefined,
        },
      ]}
      label="Más acciones"
      size="icon"
      variant="secondary"
    />
  );
};
