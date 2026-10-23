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
import {
  createTurnoverViewAction,
  deleteTurnoverViewAction,
} from "@/lib/reports/actions";
import type { TurnoverFilter } from "@/lib/reports/turnover/schema";
import {
  presetOf,
  serializeTurnoverFilter,
  turnoverHref,
  turnoverPresetLabels,
} from "@/lib/reports/turnover/url";
import type { TurnoverViewSummary } from "@/lib/reports/turnover/views";

export const TurnoverToolbar = ({
  companyId,
  filter,
  today,
  views,
  canExport,
  canExportPdf,
}: {
  companyId: string;
  filter: TurnoverFilter;
  today: string;
  views: TurnoverViewSummary[];
  canExport: boolean;
  canExportPdf: boolean;
}) => {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const preset = presetOf(filter, today);
  const exportHref = (format: "xlsx" | "csv" | "pdf") =>
    `/app/reportes/rotacion/exportar?r=${serializeTurnoverFilter(filter)}&format=${format}`;

  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);

    startTransition(async () => {
      const result = await createTurnoverViewAction({
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
      await deleteTurnoverViewAction(viewId);
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
                <Link href={turnoverHref(view.filter)}>
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

      {canExport ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm">
              <DownloadIcon aria-hidden />
              Exportar
              <ChevronDownIcon aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem asChild>
              <a download href={exportHref("xlsx")}>
                <FileSpreadsheetIcon aria-hidden />
                Excel (todas las hojas)
              </a>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <a download href={exportHref("csv")}>
                <FileTextIcon aria-hidden />
                CSV de las bajas
              </a>
            </DropdownMenuItem>
            {canExportPdf ? (
              <DropdownMenuItem asChild>
                <a download href={exportHref("pdf")}>
                  <FileTextIcon aria-hidden />
                  PDF del tablero
                </a>
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}

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
              <Label htmlFor="turnover-view-name">Nombre</Label>
              <Input
                autoFocus
                id="turnover-view-name"
                maxLength={80}
                name="name"
                placeholder="Ej. Almacén trimestral"
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
