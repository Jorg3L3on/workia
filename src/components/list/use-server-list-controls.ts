"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";

import { DEFAULT_LIST_PAGE_SIZE, LIST_PAGE_SIZES } from "@/lib/list/paging";

/** Keeps list state (`q`, filters, `page`, `pageSize`) in the URL so the server can page and search. */
export const useServerListControls = () => {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const update = useCallback(
    (
      changes: Record<string, string | null>,
      options?: { keepPage?: boolean },
    ) => {
      const next = new URLSearchParams(searchParams.toString());

      for (const [key, value] of Object.entries(changes)) {
        if (value === null || value === "") {
          next.delete(key);
        } else {
          next.set(key, value);
        }
      }

      if (!options?.keepPage) {
        next.delete("page");
      }

      const query = next.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, {
        scroll: false,
      });
    },
    [pathname, router, searchParams],
  );

  return {
    setQuery: useCallback((q: string) => update({ q }), [update]),
    setFilter: useCallback(
      (key: string, value: string | null) => update({ [key]: value }),
      [update],
    ),
    setPage: useCallback(
      (page: number) =>
        update({ page: page > 1 ? String(page) : null }, { keepPage: true }),
      [update],
    ),
    setPageSize: useCallback(
      (size: number) =>
        update({
          pageSize: size === DEFAULT_LIST_PAGE_SIZE ? null : String(size),
        }),
      [update],
    ),
    pageSizes: LIST_PAGE_SIZES,
  };
};
