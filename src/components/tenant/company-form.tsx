"use client";

import { useActionState, useEffect, useRef } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  createCompanyAction,
  setCompanyStatusAction,
  updateCompanyAction,
} from "@/lib/tenant/admin-actions";
import { EllipsisIcon } from "lucide-react";
import { ActionMenuItem } from "@/components/ui/action-menu-item";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { IconButton } from "@/components/ui/icon-button";

type CompanyFormProps = {
  company?: {
    id: string;
    name: string;
    slug: string;
    legalName: string | null;
    rfc: string | null;
  };
};

/** Create a company (no `company`) or edit one. Platform admins only. */
export const CompanyForm = ({ company }: CompanyFormProps) => {
  const [state, action, pending] = useActionState(
    company ? updateCompanyAction : createCompanyAction,
    {},
  );
  const last = useRef(state);

  useEffect(() => {
    if (state === last.current) return;
    last.current = state;
    if (state.ok) toast.success("Empresa guardada.");
  }, [state]);

  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2">
      {company ? (
        <input type="hidden" name="targetCompanyId" value={company.id} />
      ) : null}
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
        <Label htmlFor="company-slug">Identificador</Label>
        <Input
          id="company-slug"
          name="slug"
          defaultValue={company?.slug}
          placeholder="Se genera del nombre si lo dejas vacío"
          pattern="[a-z0-9]+(-[a-z0-9]+)*"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="company-legal-name">Razón social</Label>
        <Input
          id="company-legal-name"
          name="legalName"
          defaultValue={company?.legalName ?? ""}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="company-rfc">RFC de la empresa</Label>
        <Input
          id="company-rfc"
          name="rfc"
          defaultValue={company?.rfc ?? ""}
          maxLength={13}
        />
      </div>
      <div className="flex items-center gap-3 sm:col-span-2">
        <Button type="submit" disabled={pending}>
          {company ? "Guardar cambios" : "Crear empresa"}
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

/** Suspend or reactivate a company. */
export const CompanyStatusButton = ({
  companyId,
  status,
}: {
  companyId: string;
  status: "activa" | "suspendida";
}) => {
  const [state, action, pending] = useActionState(setCompanyStatusAction, {});
  const next = status === "activa" ? "suspendida" : "activa";

  return (
    <div className="flex items-center gap-3">
      {state.error ? (
        <p role="alert" className="text-destructive text-sm">
          {state.error}
        </p>
      ) : null}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton
            disabled={pending}
            label="Más acciones"
            variant="secondary"
          >
            <EllipsisIcon aria-hidden />
          </IconButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <ActionMenuItem
            action={action}
            fields={
              <>
                <input type="hidden" name="targetCompanyId" value={companyId} />
                <input type="hidden" name="status" value={next} />
              </>
            }
            variant={next === "suspendida" ? "destructive" : "default"}
          >
            {next === "suspendida" ? "Suspender empresa" : "Reactivar empresa"}
          </ActionMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
};
