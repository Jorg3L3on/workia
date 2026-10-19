import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { isValidElement, type ReactElement, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { RowMenu, type RowMenuAction } from "@/components/ui/data-table";
import { cn } from "@/lib/utils";

export type HeaderAction = {
  label: string;
  icon?: LucideIcon;
  /** Navigates (or downloads, with `download`). */
  href?: string;
  download?: boolean;
  /** Submits the form with this id, e.g. «Guardar cambios» of an edit page. */
  form?: string;
  disabled?: boolean;
};

/** A ⋯ item; `icon` is a component, turned into an element for the client menu. */
export type PageHeaderMenuAction = Omit<RowMenuAction, "icon"> & {
  icon: LucideIcon;
};

const toMenuItem = ({
  icon: Icon,
  ...item
}: PageHeaderMenuAction): RowMenuAction => ({
  ...item,
  icon: <Icon aria-hidden />,
});

type PageHeaderProps = {
  title: string;
  /** One sentence. There is no second line. */
  description?: ReactNode;
  /** Details: the status badge(s) next to the title. */
  status?: ReactNode;
  /** Details: one summary line (puesto · área · ubicación · ingreso). */
  meta?: ReactNode;
  /** The one primary action: a HeaderAction or a ready element (a form). */
  primary?: HeaderAction | ReactElement | null;
  /**
   * At most one secondary, with an icon. Below 768px a HeaderAction moves
   * into ⋯ (a custom menu adds it itself, as a `mobileOnly` item); a ready
   * element stays where it is.
   */
  secondary?: HeaderAction | ReactElement | null;
  /** Everything else, in the ⋯ menu (destructive last, behind a confirm), or a custom menu. */
  menu?:
    (PageHeaderMenuAction | false | null | undefined)[] | ReactElement | null;
  menuLabel?: string;
  /** detail: on phones the primary spans the width. */
  variant?: "list" | "detail";
  className?: string;
};

const ActionButton = ({
  action,
  variant,
  className,
}: {
  action: HeaderAction;
  variant: "primary" | "secondary";
  className?: string;
}) => {
  const Icon = action.icon;
  const content = (
    <>
      {Icon ? <Icon aria-hidden /> : null}
      {action.label}
    </>
  );

  if (action.href && !action.disabled) {
    return (
      <Button asChild className={className} variant={variant}>
        {action.download ? (
          <a download href={action.href}>
            {content}
          </a>
        ) : (
          <Link href={action.href}>{content}</Link>
        )}
      </Button>
    );
  }

  return (
    <Button
      className={className}
      disabled={action.disabled}
      form={action.form}
      type={action.form ? "submit" : "button"}
      variant={variant}
    >
      {content}
    </Button>
  );
};

const isHeaderAction = (value: unknown): value is HeaderAction =>
  Boolean(value) && !isValidElement(value);

/**
 * The header of every list and detail: title (with status on details), one
 * sentence or a meta line, one primary, one secondary and a ⋯ menu for the
 * rest. Below 768px only the primary and ⋯ show. The breadcrumb is the way
 * back, so there are no «Volver» links.
 */
export const PageHeader = ({
  title,
  description,
  status,
  meta,
  primary,
  secondary,
  menu,
  menuLabel = "Más acciones",
  variant = "list",
  className,
}: PageHeaderProps) => {
  const isDetail = variant === "detail";
  const menuActions = Array.isArray(menu)
    ? [
        // The secondary folds into ⋯ on phones.
        isHeaderAction(secondary) && (secondary.href || secondary.form)
          ? {
              label: secondary.label,
              icon: secondary.icon ? <secondary.icon aria-hidden /> : <span />,
              href: secondary.href,
              download: secondary.download,
              mobileOnly: true,
            }
          : null,
        ...menu
          .filter((item): item is PageHeaderMenuAction => Boolean(item))
          .map(toMenuItem),
      ]
    : null;
  const menuNode = menuActions ? (
    <RowMenu
      actions={menuActions}
      label={menuLabel}
      size="icon"
      variant="secondary"
    />
  ) : Array.isArray(menu) ? null : (
    (menu ?? null)
  );
  const hasActions = Boolean(primary || secondary || menuNode);

  // A grid so the actions share the title's row on phones too; the
  // description and meta wrap under both.
  return (
    <header
      className={cn(
        "grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1",
        className,
      )}
      data-slot="page-header"
    >
      <div className="col-start-1 row-start-1 flex min-h-9 min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <h1 className="text-2xl font-semibold tracking-tight text-balance">
          {title}
        </h1>
        {status}
      </div>
      {meta || description ? (
        <div className="col-span-2 space-y-1 md:col-span-1 md:col-start-1">
          {meta ? (
            <p className="text-muted-foreground text-sm tabular-nums">{meta}</p>
          ) : null}
          {description ? (
            <p className="text-muted-foreground text-sm">{description}</p>
          ) : null}
        </div>
      ) : null}
      {hasActions ? (
        <div
          className={cn(
            "flex items-center gap-2 md:col-start-2 md:row-span-2 md:row-start-1",
            isDetail
              ? "col-span-2 mt-2 md:col-span-1 md:mt-0"
              : "col-start-2 row-start-1",
          )}
        >
          {isHeaderAction(secondary) ? (
            <ActionButton
              action={secondary}
              className="hidden md:inline-flex"
              variant="secondary"
            />
          ) : (
            (secondary ?? null)
          )}
          {isHeaderAction(primary) ? (
            <ActionButton
              action={primary}
              className={cn(isDetail && "flex-1 md:flex-none")}
              variant="primary"
            />
          ) : (
            (primary ?? null)
          )}
          {menuNode}
        </div>
      ) : null}
    </header>
  );
};
