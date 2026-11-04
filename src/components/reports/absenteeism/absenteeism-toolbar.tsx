"use client";

import {
  BookmarkIcon,
  ChevronDownIcon,
  DownloadIcon,
  FileSpreadsheetIcon,
  FileTextIcon,
  SaveIcon,
  Trash2Icon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { AbsenteeismFilter } from "@/lib/reports/absenteeism/schema";
import {
  absenteeismHref,
  serializeAbsenteeismFilter,
} from "@/lib/reports/absenteeism/url";
import type { AbsenteeismViewSummary } from "@/lib/reports/absenteeism/views";
import {
  createAbsenteeismViewAction,
  deleteAbsenteeismViewAction,
} from "@/lib/reports/actions";
import { presetOf, turnoverPresetLabels } from "@/lib/reports/turnover/url";

/**
 * Saved views and exports of the absenteeism report (W2-20), like the
 * turnover report's toolbar. The CSV is the table; the Excel names people,
 * so it needs people:read and people:export.
 */
export const AbsenteeismToolbar = ({
  companyId,
  filter,
  today,
  views,
  canExportPeople,
}: {
  companyId: string;
  filter: AbsenteeismFilter;
  today: string;
  views: AbsenteeismViewSummary[];
  canExportPeople: boolean;
}) => {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const preset = presetOf(filter, today);
  const exportHref = (format: "xlsx" | "csv") =>
    `/app/reportes/ausentismo/exportar?a=${serializeAbsenteeismFilter(filter)}&format=${format}`;

  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);

    startTransition(async () => {
      const result = await createAbsenteeismViewAction({
        companyId,
        name: String(data.get("name") ?? ""),
        shared: data.get("shared") === "on",
        filter,
      });

      if (!result.ok) {
        setError(result.error);
        return;
      }

      setError(null);
      setSaving(false);
      router.refresh();
    });
  };

  const remove = (viewId: string) =>
    startTransition(async () => {
      await deleteAbsenteeismViewAction(viewId);
      router.refresh();
    });

  return (
    <div className="flex flex-wrap items-center gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="secondary">
            <BookmarkIcon aria-hidden />
            Vistas
            <ChevronDownIcon aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72">
          {views.length === 0 ? (
            <DropdownMenuLabel className="text-muted-foreground font-normal">
              Sin vistas guardadas
            </DropdownMenuLabel>
          ) : (
            views.map((view) => (
              <DropdownMenuItem
                asChild
                className="flex items-center justify-between gap-2"
                key={view.id}
              >
                <Link href={absenteeismHref(view.filter)}>
                  <span className="min-w-0">
                    <span className="block truncate">{view.name}</span>
                    <span className="text-muted-foreground block text-xs">
                      {view.preset
                        ? turnoverPresetLabels[view.preset]
                        : "Fechas fijas"}
                      {view.isOwner
                        ? view.shared
                          ? " · compartida"
                          : ""
                        : ` · de ${view.ownerName ?? "otra persona"}`}
                    </span>
                  </span>
                  {view.isOwner ? (
                    <Button
                      aria-label={`Borrar la vista ${view.name}`}
                      className="size-7 shrink-0"
                      disabled={pending}
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        remove(view.id);
                      }}
                      size="icon"
                      variant="ghost"
                    >
                      <Trash2Icon className="size-3.5" />
                    </Button>
                  ) : null}
                </Link>
              </DropdownMenuItem>
            ))
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setSaving(true)}>
            <SaveIcon aria-hidden />
            Guardar esta vista
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm">
            <DownloadIcon aria-hidden />
            Exportar
            <ChevronDownIcon aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {canExportPeople ? (
            <DropdownMenuItem asChild>
              <a download href={exportHref("xlsx")}>
                <FileSpreadsheetIcon aria-hidden />
                Excel (con bajas y faltas por persona)
              </a>
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem asChild>
            <a download href={exportHref("csv")}>
              <FileTextIcon aria-hidden />
              CSV por región y sucursal
            </a>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog onOpenChange={setSaving} open={saving}>
        <DialogContent>
          <form className="space-y-4" onSubmit={save}>
            <DialogHeader>
              <DialogTitle>Guardar vista del reporte</DialogTitle>
              <DialogDescription>
                {preset === "custom"
                  ? "Guarda los filtros con estas mismas fechas."
                  : `Guarda los filtros con «${turnoverPresetLabels[preset]}»: al abrirla se calcula a partir de ese día.`}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Label htmlFor="absenteeism-view-name">Nombre</Label>
              <Input
                autoFocus
                id="absenteeism-view-name"
                maxLength={80}
                name="name"
                placeholder="Ej. Región Norte mensual"
                required
              />
            </div>
            <Label className="flex items-center justify-between gap-3 font-normal">
              Compartir con la empresa (sólo lectura)
              <Switch name="shared" />
            </Label>
            {error ? (
              <p className="text-destructive text-sm" role="alert">
                {error}
              </p>
            ) : null}
            <DialogFooter>
              <Button disabled={pending} type="submit">
                Guardar vista
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
};
