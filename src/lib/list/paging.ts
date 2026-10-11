export const LIST_PAGE_SIZES = [10, 25, 50] as const;
export const DEFAULT_LIST_PAGE_SIZE = 25;

const toPositiveInt = (value: string | undefined) => {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

/** Reads `?page=&pageSize=` from search params, clamping to sane values. */
export const parseListPaging = (params: {
  page?: string;
  pageSize?: string;
}) => {
  const requested = toPositiveInt(params.pageSize);
  const pageSize =
    LIST_PAGE_SIZES.find((size) => size === requested) ??
    DEFAULT_LIST_PAGE_SIZE;

  return { page: toPositiveInt(params.page) ?? 1, pageSize };
};

export const pageCountFor = (total: number, pageSize: number) =>
  Math.max(1, Math.ceil(total / pageSize));
