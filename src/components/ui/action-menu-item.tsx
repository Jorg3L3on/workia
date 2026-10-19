"use client";

import { useRef, type ReactNode } from "react";

import { DropdownMenuItem } from "@/components/ui/dropdown-menu";

type ActionMenuItemProps = {
  /** A server action, bound to its record or fed by `fields`. */
  action: (formData: FormData) => void | Promise<void>;
  /** Hidden inputs the action reads. */
  fields?: ReactNode;
  children: ReactNode;
  variant?: "default" | "destructive";
};

/** A ⋯ menu item that submits a server action (destructive ones go last). */
export const ActionMenuItem = ({
  action,
  fields,
  children,
  variant,
}: ActionMenuItemProps) => {
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form action={action} ref={formRef}>
      {fields}
      <DropdownMenuItem
        // Submit while the menu is still mounted; the menu then closes.
        onSelect={() => formRef.current?.requestSubmit()}
        variant={variant}
      >
        {children}
      </DropdownMenuItem>
    </form>
  );
};
