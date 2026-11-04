import { ChevronLeftIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

/** Frame of an employee app screen below the home (W2-11): back to /mi and a title. */
export const EmployeeSubpage = ({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) => (
  <main className="mx-auto flex min-h-svh w-full max-w-xl flex-col gap-4 px-4 pt-4 pb-10">
    <Link
      className="text-muted-foreground -ml-1 flex min-h-11 w-fit items-center gap-1 text-sm font-medium"
      href="/mi"
    >
      <ChevronLeftIcon aria-hidden className="size-4" />
      Inicio
    </Link>
    <header className="space-y-1">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      {description ? (
        <p className="text-muted-foreground text-sm">{description}</p>
      ) : null}
    </header>
    {children}
  </main>
);
