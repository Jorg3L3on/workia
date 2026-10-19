import Link from "next/link";

import { Button } from "@/components/ui/button";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
} from "@/components/ui/pagination";

type ListPagerProps = {
  page: number;
  pageCount: number;
  /** Current search params; the pager only swaps `page`. */
  params: Record<string, string | undefined>;
  pathname: string;
};

const hrefFor = (
  pathname: string,
  params: Record<string, string | undefined>,
  page: number,
) => {
  const next = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value && key !== "page") {
      next.set(key, value);
    }
  }

  if (page > 1) {
    next.set("page", String(page));
  }

  const query = next.toString();
  return query ? `${pathname}?${query}` : pathname;
};

/** Link-based pager for server-rendered lists (no client JS). */
export const ListPager = ({
  page,
  pageCount,
  params,
  pathname,
}: ListPagerProps) => {
  if (pageCount <= 1) {
    return null;
  }

  return (
    <Pagination className="mx-0 justify-between">
      <p className="text-muted-foreground text-xs tabular-nums">
        Página {page} de {pageCount}
      </p>
      <PaginationContent>
        <PaginationItem>
          {page > 1 ? (
            <Button asChild size="sm" variant="secondary">
              <Link
                aria-label="Página anterior"
                href={hrefFor(pathname, params, page - 1)}
              >
                Anterior
              </Link>
            </Button>
          ) : (
            <Button disabled size="sm" variant="secondary">
              Anterior
            </Button>
          )}
        </PaginationItem>
        <PaginationItem>
          {page < pageCount ? (
            <Button asChild size="sm" variant="secondary">
              <Link
                aria-label="Página siguiente"
                href={hrefFor(pathname, params, page + 1)}
              >
                Siguiente
              </Link>
            </Button>
          ) : (
            <Button disabled size="sm" variant="secondary">
              Siguiente
            </Button>
          )}
        </PaginationItem>
      </PaginationContent>
    </Pagination>
  );
};
