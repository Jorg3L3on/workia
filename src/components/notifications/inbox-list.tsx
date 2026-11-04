import Link from "next/link";

import { Button } from "@/components/ui/button";
import { formatDateTimeMx } from "@/lib/format/date";
import type { InboxItem } from "@/lib/notifications";
import { cn } from "@/lib/utils";

type InboxListProps = {
  items: InboxItem[];
  /** Marks the message read and opens its path; gets the form with `id`. */
  openAction: (formData: FormData) => Promise<void>;
  markAllAction: () => Promise<void>;
  unread: number;
  /** Link to the next page (keyset cursor), or null on the last one. */
  nextHref: string | null;
  /** Shown first on a later page, back to the newest messages. */
  firstHref?: string | null;
};

/**
 * The in-app inbox of W2-08, for both apps: newest first, unread in bold
 * with a dot. Opening a message marks it read. The text is the one stored
 * when it was sent.
 */
export const InboxList = ({
  items,
  openAction,
  markAllAction,
  unread,
  nextHref,
  firstHref,
}: InboxListProps) => (
  <section aria-labelledby="avisos-lista" className="flex flex-col gap-3">
    <div className="flex items-center justify-between gap-3">
      <h2 className="text-base font-semibold" id="avisos-lista">
        {unread > 0
          ? `${unread >= 100 ? "99+" : unread} sin leer`
          : "Todo leído"}
      </h2>
      {unread > 0 ? (
        <form action={markAllAction}>
          <Button size="sm" type="submit" variant="ghost">
            Marcar todo como leído
          </Button>
        </form>
      ) : null}
    </div>

    {firstHref ? (
      <Link className="text-primary text-sm underline" href={firstHref}>
        Ver los más recientes
      </Link>
    ) : null}

    {items.length === 0 ? (
      <p className="text-muted-foreground text-sm">
        No tienes avisos. Aquí verás tus recibos, las respuestas a tus
        solicitudes y lo que RH necesite de ti.
      </p>
    ) : (
      <ul className="divide-border flex flex-col divide-y rounded-xl border">
        {items.map((item) => (
          <li key={item.id}>
            <form action={openAction}>
              <input name="id" type="hidden" value={item.id} />
              <button
                className="hover:bg-muted/60 flex w-full items-start gap-3 px-4 py-3 text-left transition-colors"
                type="submit"
              >
                <span
                  aria-hidden
                  className={cn(
                    "mt-1.5 size-2 shrink-0 rounded-full",
                    item.readAt ? "bg-transparent" : "bg-primary",
                  )}
                />
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span
                    className={cn(
                      "text-sm break-words",
                      item.readAt ? "font-normal" : "font-semibold",
                    )}
                  >
                    {item.readAt ? null : (
                      <span className="sr-only">Sin leer: </span>
                    )}
                    {item.title}
                  </span>
                  <span className="text-muted-foreground text-sm break-words">
                    {item.body}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {formatDateTimeMx(item.createdAt)}
                  </span>
                </span>
              </button>
            </form>
          </li>
        ))}
      </ul>
    )}

    {nextHref ? (
      <Link
        className="text-primary self-center text-sm underline"
        href={nextHref}
      >
        Ver avisos anteriores
      </Link>
    ) : null}
  </section>
);
