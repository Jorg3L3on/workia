"use client";

import Link from "next/link";
import { MoreHorizontalIcon, type LucideIcon } from "lucide-react";
import {
  Fragment,
  isValidElement,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";

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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { IconButton } from "@/components/ui/icon-button";

export type RowMenuAction = {
  label: string;
  /** A component, or an element when a server component builds the menu. */
  icon: LucideIcon | ReactElement;
  /** Navigates. */
  href?: string;
  /** With `href`: a file download, not a page. */
  download?: boolean;
  /** Opens a dialog or runs client code. */
  onSelect?: () => void;
  /** A server action, submitted on select (or on confirm), with `fields`. */
  action?: (formData: FormData) => void | Promise<void>;
  fields?: ReactNode;
  /** Red, always last, behind a separator. */
  destructive?: boolean;
  /** Asks first in an AlertDialog. */
  confirm?: { title: string; description: ReactNode; confirmLabel: string };
  /** Only below 768px, e.g. a header secondary that folds into the menu. */
  mobileOnly?: boolean;
};

type RowMenuProps = {
  /** Accessible name of the ⋯ trigger, e.g. «Acciones de Sofía». */
  label: string;
  actions: (RowMenuAction | false | null | undefined)[];
  /** Page headers use a bigger, outlined trigger. */
  size?: "icon-sm" | "icon";
  variant?: "ghost" | "secondary";
};

/**
 * The ⋯ menu at the end of a row: every row action but the inline one, with
 * icons, the destructive one last in red behind a confirmation.
 */
export const RowMenu = ({
  label,
  actions,
  size = "icon-sm",
  variant = "ghost",
}: RowMenuProps) => {
  const items = actions.filter((item): item is RowMenuAction => Boolean(item));
  const ordered = [
    ...items.filter((item) => !item.destructive),
    ...items.filter((item) => item.destructive),
  ];
  const formRefs = useRef<(HTMLFormElement | null)[]>([]);
  const [confirming, setConfirming] = useState<number | null>(null);

  if (ordered.length === 0) {
    return null;
  }

  const run = (index: number) => {
    const item = ordered[index];

    if (item.action) {
      formRefs.current[index]?.requestSubmit();
    }

    item.onSelect?.();
  };

  const pending = confirming === null ? null : ordered[confirming];

  return (
    <>
      {ordered.map((item, index) =>
        item.action ? (
          <form
            action={item.action}
            className="hidden"
            key={`form-${item.label}`}
            ref={(node) => {
              formRefs.current[index] = node;
            }}
          >
            {item.fields}
          </form>
        ) : null,
      )}
      {/* Not modal, so a dialog opened from an item gets focus cleanly. */}
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <IconButton label={label} size={size} variant={variant}>
            <MoreHorizontalIcon aria-hidden />
          </IconButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-48">
          {ordered.map((item, index) => {
            const Icon = item.icon;
            const content = (
              <>
                {isValidElement(Icon) ? Icon : <Icon aria-hidden />}
                {item.label}
              </>
            );
            const firstDestructive =
              item.destructive && index > 0 && !ordered[index - 1].destructive;
            const itemClassName = item.mobileOnly ? "md:hidden" : undefined;

            return (
              <Fragment key={item.label}>
                {firstDestructive ? <DropdownMenuSeparator /> : null}
                {item.href ? (
                  <DropdownMenuItem asChild className={itemClassName}>
                    {item.download ? (
                      <a download href={item.href}>
                        {content}
                      </a>
                    ) : (
                      <Link href={item.href}>{content}</Link>
                    )}
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem
                    className={itemClassName}
                    onSelect={() =>
                      item.confirm ? setConfirming(index) : run(index)
                    }
                    variant={item.destructive ? "destructive" : "default"}
                  >
                    {content}
                  </DropdownMenuItem>
                )}
              </Fragment>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialog
        onOpenChange={(open) => {
          if (!open) setConfirming(null);
        }}
        open={pending !== null}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{pending?.confirm?.title}</AlertDialogTitle>
            <AlertDialogDescription>
              {pending?.confirm?.description}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirming !== null) run(confirming);
              }}
              variant={pending?.destructive ? "destructive" : "primary"}
            >
              {pending?.confirm?.confirmLabel}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

type RowInlineActionProps = {
  label: string;
  icon: LucideIcon;
  href?: string;
  onClick?: () => void;
};

/** The one inline row action: an icon with a tooltip, shown on hover and focus. */
export const RowInlineAction = ({
  label,
  icon: Icon,
  href,
  onClick,
}: RowInlineActionProps) =>
  href ? (
    <IconButton asChild label={label} size="icon-sm">
      <Link href={href}>
        <Icon aria-hidden />
      </Link>
    </IconButton>
  ) : (
    <IconButton label={label} onClick={onClick} size="icon-sm" type="button">
      <Icon aria-hidden />
    </IconButton>
  );
