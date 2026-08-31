import type { Metadata } from "next";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { pageTitles } from "@/lib/brand/chrome-copy";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createContractTemplateAction } from "@/lib/contracts/actions";
import { requireContractTemplatesCreate } from "@/lib/contracts/auth";
import { CONTRACT_TEMPLATE_TOKENS } from "@/lib/contracts/schema";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: pageTitles.nuevaPlantilla,
};

type NuevaPlantillaPageProps = {
  searchParams: Promise<{ error?: string }>;
};

const NuevaPlantillaPage = async ({
  searchParams,
}: NuevaPlantillaPageProps) => {
  try {
    await requireContractTemplatesCreate();
  } catch {
    redirect("/app/contratos/plantillas?error=create-permission");
  }

  const { error } = await searchParams;

  const defaultBody = `Contrato de trabajo

El presente contrato se celebra con {{nombres}} {{apellido_paterno}} {{apellido_materno}}, RFC {{rfc}}, para desempeñar el puesto de {{puesto}} en el área de {{area}}, con ubicación en {{sucursal}}.

Vigencia: del {{fecha_inicio}} al {{fecha_fin}}.`;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <header className="space-y-1">
        <p className="text-muted-foreground font-mono text-[10.5px] font-medium tracking-[0.09em] uppercase">
          Contratos
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">
          Nueva plantilla
        </h1>
      </header>

      {error ? (
        <p className="text-destructive text-sm" role="alert">
          Revisa los datos de la plantilla.
        </p>
      ) : null}

      <form
        action={createContractTemplateAction}
        className="workia-pass-card space-y-4 p-5"
      >
        <div className="space-y-2">
          <Label htmlFor="name">Nombre</Label>
          <Input
            defaultValue="Contrato determinado demo"
            id="name"
            name="name"
            required
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="body">Cuerpo</Label>
          <textarea
            className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 min-h-48 w-full rounded-lg border px-3 py-2 text-sm outline-none focus-visible:ring-3"
            defaultValue={defaultBody}
            id="body"
            name="body"
            required
          />
          <p className="text-muted-foreground text-xs">
            Variables disponibles:{" "}
            {CONTRACT_TEMPLATE_TOKENS.map((token) => `{{${token}}}`).join(", ")}
          </p>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input defaultChecked name="active" type="checkbox" value="true" />
          Plantilla activa
        </label>

        <div className="flex gap-2">
          <Button
            className="workia-accent-gradient border-0 text-white shadow-md hover:opacity-95"
            type="submit"
          >
            Guardar plantilla
          </Button>
          <Button asChild variant="ghost">
            <Link href="/app/contratos/plantillas">Cancelar</Link>
          </Button>
        </div>
      </form>
    </div>
  );
};

export default NuevaPlantillaPage;
