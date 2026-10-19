"use client";

import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

type FormSheetProps = {
  /** The PageHeader primary that opens the sheet; without it the owner opens it (e.g. edit from a row). */
  triggerLabel?: string;
  triggerIcon?: LucideIcon;
  title: string;
  description?: ReactNode;
  /** Id of the `<form>` in `children`; the footer's primary submits it. */
  formId: string;
  submitLabel: string;
  pending?: boolean;
  /** E.g. until a required picker has a value. */
  submitDisabled?: boolean;
  /** Hides the footer, e.g. while showing a one-time result. */
  hideFooter?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
};

/**
 * A quick create (WRK-I6-4): the list stays first, the header's primary opens
 * this side sheet with the form and Cancelar / primary in the footer.
 */
export const FormSheet = ({
  triggerLabel,
  triggerIcon: Icon,
  title,
  description,
  formId,
  submitLabel,
  pending = false,
  submitDisabled = false,
  hideFooter = false,
  open,
  onOpenChange,
  children,
}: FormSheetProps) => (
  <Sheet onOpenChange={onOpenChange} open={open}>
    {triggerLabel ? (
      <SheetTrigger asChild>
        <Button>
          {Icon ? <Icon aria-hidden /> : null}
          {triggerLabel}
        </Button>
      </SheetTrigger>
    ) : null}
    <SheetContent className="gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-md">
      <SheetHeader className="border-b pr-12">
        <SheetTitle>{title}</SheetTitle>
        {description ? (
          <SheetDescription>{description}</SheetDescription>
        ) : null}
      </SheetHeader>
      <div className="flex-1 overflow-y-auto p-4">{children}</div>
      {hideFooter ? null : (
        <SheetFooter className="flex-row justify-end border-t">
          <Button
            onClick={() => onOpenChange(false)}
            type="button"
            variant="ghost"
          >
            Cancelar
          </Button>
          <Button
            disabled={pending || submitDisabled}
            form={formId}
            type="submit"
          >
            {pending ? "Guardando…" : submitLabel}
          </Button>
        </SheetFooter>
      )}
    </SheetContent>
  </Sheet>
);
