import Link from "next/link";
import { ChevronLeftIcon } from "lucide-react";

/** Back link and title of the manager screens in /mi (W2-07). */
export const TeamPageHeader = ({
  backHref,
  backLabel,
  title,
  subtitle,
}: {
  backHref: string;
  backLabel: string;
  title: string;
  subtitle?: string | null;
}) => (
  <header className="space-y-3">
    <Link
      className="text-muted-foreground inline-flex min-h-10 items-center gap-1 text-sm font-medium"
      href={backHref}
    >
      <ChevronLeftIcon aria-hidden className="size-4" />
      {backLabel}
    </Link>
    <div className="space-y-1">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      {subtitle ? (
        <p className="text-muted-foreground text-sm">{subtitle}</p>
      ) : null}
    </div>
  </header>
);
