"use client";

import {
  EllipsisIcon,
  PencilIcon,
  PlusIcon,
  SaveIcon,
  Share2Icon,
  Trash2Icon,
  UsersIcon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { PeopleColumnId } from "@/lib/people/filter/columns";
import {
  coercePeopleFilter,
  type PeopleFilter,
} from "@/lib/people/filter/schema";
import { serializeFilterConditions } from "@/lib/people/filter/url";
import type { PeopleViewSummary } from "@/lib/people/views";
import {
  createPeopleViewAction,
  deletePeopleViewAction,
  updatePeopleViewAction,
} from "@/lib/people/views/actions";
import { cn } from "@/lib/utils";

type ViewLink = (
  view: Pick<PeopleViewSummary, "id" | "filter" | "columns"> | null,
) => string;

const sameView = (
  view: PeopleViewSummary,
  filter: PeopleFilter,
  columns: readonly PeopleColumnId[],
) => {
  const a = coercePeopleFilter(view.filter);
  const b = coercePeopleFilter(filter);
  return (
    a.q === b.q &&
    a.deleted === b.deleted &&
    serializeFilterConditions(a) === serializeFilterConditions(b) &&
    view.columns.join(".") === columns.join(".")
  );
};

const tabClassName = (active: boolean) =>
  cn(
    "relative inline-flex h-9 shrink-0 items-center gap-1.5 border-b-2 px-3 text-sm whitespace-nowrap transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
    active
      ? "border-primary text-foreground font-medium"
      : "text-muted-foreground hover:text-foreground border-transparent",
  );

const SaveViewDialog = ({
  open,
  onOpenChange,
  title,
  initialName,
  initialShared,
  onSave,
  pending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  initialName: string;
  initialShared: boolean;
  onSave: (input: { name: string; shared: boolean }) => void;
  pending: boolean;
}) => {
  const id = useId();
  const [name, setName] = useState(initialName);
  const [shared, setShared] = useState(initialShared);

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="sm:max-w-md">
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            onSave({ name, shared });
          }}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>
              Guarda los filtros y las columnas visibles de la lista.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor={`${id}-name`}>Nombre</Label>
            <Input
              autoFocus
              id={`${id}-name`}
              maxLength={80}
              onChange={(event) => setName(event.target.value)}
              placeholder="Contratos por vencer"
              required
              value={name}
            />
          </div>
          <div className="flex items-start justify-between gap-4">
            <div className="grid gap-0.5">
              <Label htmlFor={`${id}-shared`}>Compartir con la empresa</Label>
              <p className="text-muted-foreground text-sm">
                La ven todas las personas de esta empresa con acceso a Personas.
                Sólo tú puedes cambiarla.
              </p>
            </div>
            <Switch
              checked={shared}
              id={`${id}-shared`}
              onCheckedChange={setShared}
            />
          </div>
          <DialogFooter>
            <Button disabled={pending || !name.trim()} type="submit">
              Guardar vista
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

/**
 * Saved views as tabs over the list. A tab opens the view's own link (its
 * filter and columns in the URL), so the URL always decides what is shown;
 * «editada» marks a view whose filter or columns were changed since.
 */
export const PeopleViewsTabs = ({
  views,
  activeViewId,
  filter,
  columns,
  viewHref,
}: {
  views: PeopleViewSummary[];
  activeViewId: string | null;
  filter: PeopleFilter;
  columns: readonly PeopleColumnId[];
  viewHref: ViewLink;
}) => {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [dialog, setDialog] = useState<"new" | "rename" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const active = views.find((view) => view.id === activeViewId) ?? null;
  const edited = active ? !sameView(active, filter, columns) : false;

  const run = (
    work: () => Promise<
      { ok: true; view?: PeopleViewSummary } | { ok: false; error?: string }
    >,
    after: (view?: PeopleViewSummary) => void,
  ) =>
    startTransition(async () => {
      const result = await work();

      if (!result.ok) {
        toast.error(result.error ?? "No se pudo guardar la vista.");
        return;
      }

      after(result.view);
      router.refresh();
    });

  const save = (
    target: PeopleViewSummary,
    changes: Partial<PeopleViewSummary>,
  ) =>
    run(
      () =>
        updatePeopleViewAction(target.id, {
          name: changes.name ?? target.name,
          shared: changes.shared ?? target.shared,
          filter: changes.filter ?? target.filter,
          columns: changes.columns ?? target.columns,
        }),
      (view) => {
        toast.success("Vista guardada.");
        if (view) router.replace(viewHref(view), { scroll: false });
      },
    );

  return (
    <div className="flex items-end gap-2 border-b">
      <nav
        aria-label="Vistas guardadas"
        className="no-scrollbar -mb-px flex min-w-0 flex-1 items-end overflow-x-auto"
      >
        <Link
          aria-current={!activeViewId ? "page" : undefined}
          className={tabClassName(!activeViewId)}
          href={viewHref(null)}
          replace
          scroll={false}
        >
          Todas
        </Link>
        {views.map((view) => {
          const current = view.id === activeViewId;

          return (
            <Link
              aria-current={current ? "page" : undefined}
              className={tabClassName(current)}
              href={viewHref(view)}
              key={view.id}
              replace
              scroll={false}
              title={
                view.shared && !view.isOwner && view.ownerName
                  ? `Compartida por ${view.ownerName}`
                  : undefined
              }
            >
              {view.shared ? (
                <UsersIcon
                  aria-label="Compartida"
                  className="text-muted-foreground size-3.5"
                />
              ) : null}
              <span className="max-w-48 truncate">{view.name}</span>
              {current && edited ? (
                <span className="text-muted-foreground text-xs font-normal">
                  · editada
                </span>
              ) : null}
            </Link>
          );
        })}
      </nav>

      <div className="flex shrink-0 items-center gap-1 pb-1">
        {active?.isOwner ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                aria-label={`Acciones de la vista ${active.name}`}
                size="icon-sm"
                type="button"
                variant="ghost"
              >
                <EllipsisIcon aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                disabled={!edited || pending}
                onSelect={() => save(active, { filter, columns: [...columns] })}
              >
                <SaveIcon aria-hidden />
                Guardar cambios
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setDialog("rename")}>
                <PencilIcon aria-hidden />
                Renombrar
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={pending}
                onSelect={() => save(active, { shared: !active.shared })}
              >
                <Share2Icon aria-hidden />
                {active.shared
                  ? "Dejar de compartir"
                  : "Compartir con la empresa"}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() => setConfirmDelete(true)}
                variant="destructive"
              >
                <Trash2Icon aria-hidden />
                Eliminar vista
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
        <Button
          className="h-8"
          onClick={() => setDialog("new")}
          size="sm"
          type="button"
          variant="ghost"
        >
          <PlusIcon aria-hidden />
          <span className="hidden sm:inline">Guardar vista</span>
          <span className="sr-only sm:hidden">Guardar vista</span>
        </Button>
      </div>

      {dialog ? (
        <SaveViewDialog
          initialName={dialog === "rename" && active ? active.name : ""}
          initialShared={dialog === "rename" && active ? active.shared : false}
          onOpenChange={(open) => setDialog(open ? dialog : null)}
          onSave={({ name, shared }) => {
            if (dialog === "rename" && active) {
              save(active, { name, shared });
              setDialog(null);
              return;
            }

            run(
              () =>
                createPeopleViewAction({
                  name,
                  shared,
                  filter,
                  columns: [...columns],
                }),
              (view) => {
                setDialog(null);
                toast.success("Vista guardada.");
                if (view) router.replace(viewHref(view), { scroll: false });
              },
            );
          }}
          open
          pending={pending}
          title={dialog === "rename" ? "Renombrar vista" : "Nueva vista"}
        />
      ) : null}

      <AlertDialog onOpenChange={setConfirmDelete} open={confirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar la vista?</AlertDialogTitle>
            <AlertDialogDescription>
              {active?.shared
                ? "También desaparece para quienes la ven compartida."
                : "Los filtros guardados en ella se pierden."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                active &&
                run(
                  () => deletePeopleViewAction(active.id),
                  () => {
                    toast.success("Vista eliminada.");
                    router.replace(viewHref(null), { scroll: false });
                  },
                )
              }
              variant="destructive"
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};
