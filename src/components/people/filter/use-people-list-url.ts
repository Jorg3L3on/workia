"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";
import { toast } from "sonner";

import {
  serializePeopleColumns,
  type PeopleColumnId,
} from "@/lib/people/filter/columns";
import type { PeopleFilter } from "@/lib/people/filter/schema";
import { writePeopleFilterParams } from "@/lib/people/filter/url";

const TOO_LONG =
  "Son demasiados filtros para un enlace. Quita algunos valores e inténtalo de nuevo.";

/**
 * The Personas list state lives in the URL (filter, view, columns, page), so
 * reloading or sharing the link reproduces the same result. Every change
 * goes back to page 1.
 */
export const usePeopleListUrl = () => {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const go = useCallback(
    (next: URLSearchParams) => {
      next.delete("page");
      const query = next.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, {
        scroll: false,
      });
    },
    [pathname, router],
  );

  const applyFilter = useCallback(
    (filter: PeopleFilter) => {
      const next = new URLSearchParams(searchParams.toString());

      if (!writePeopleFilterParams(next, filter)) {
        toast.error(TOO_LONG);
        return false;
      }

      go(next);
      return true;
    },
    [go, searchParams],
  );

  const setColumns = useCallback(
    (columns: readonly PeopleColumnId[]) => {
      const next = new URLSearchParams(searchParams.toString());
      next.set("cols", serializePeopleColumns(columns));
      go(next);
    },
    [go, searchParams],
  );

  /** A view's own link: its id, filter and columns (null: «Todas»). */
  const viewHref = useCallback(
    (
      view: {
        id: string;
        filter: PeopleFilter;
        columns: readonly PeopleColumnId[];
      } | null,
    ) => {
      const next = new URLSearchParams();
      const pageSize = searchParams.get("pageSize");

      if (pageSize) next.set("pageSize", pageSize);

      if (view) {
        next.set("view", view.id);
        writePeopleFilterParams(next, view.filter);
        next.set("cols", serializePeopleColumns(view.columns));
      }

      const query = next.toString();
      return query ? `${pathname}?${query}` : pathname;
    },
    [pathname, searchParams],
  );

  const openView = useCallback(
    (view: Parameters<typeof viewHref>[0]) => {
      router.replace(viewHref(view), { scroll: false });
    },
    [router, viewHref],
  );

  return { applyFilter, setColumns, openView, viewHref };
};
