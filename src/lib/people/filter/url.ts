/**
 * The Personas filter in the URL. The conditions go in one compact, versioned
 * parameter `f`; the search stays in `q` and the borrados switch in
 * `deleted=1`, as before. Links from before this filter (`status`, `region`,
 * and the export's `area`/`site`) are read into it.
 *
 *   f=1~st.i.baja~ar.i.<id>.<id>~in.b.20250101.20260930~je.it.<id>~ve.n.30
 *
 * After the version, `~` separates conditions; inside one, `.` separates the
 * field key, the operator code and its arguments. Uuids are written in
 * base64url (22 characters instead of 36) and dates as YYYYMMDD. Every
 * character is URL-safe, so nothing is percent-encoded.
 */

import { parseListPaging } from "@/lib/list/paging";

import {
  PEOPLE_FILTER_FIELDS,
  peopleFilterFieldByUrlKey,
  type PeopleFilterOperator,
} from "./fields";
import {
  coercePeopleFilter,
  type PeopleFilter,
  type PeopleFilterCondition,
} from "./schema";

export const PEOPLE_FILTER_URL_VERSION = "1";
/** Longest `f` accepted and produced; longer ones are ignored. */
export const MAX_FILTER_PARAM_LENGTH = 1800;

const OP_CODES: Record<PeopleFilterOperator, string> = {
  is: "i",
  is_not: "x",
  between: "b",
  before: "lt",
  after: "gt",
  empty: "e",
  not_empty: "ne",
  next_days: "n",
};
/** «es» / «no es» with the whole team below (Jefe). */
const TEAM_CODES = { is: "it", is_not: "xt" } as const;

const opByCode = new Map<string, { op: PeopleFilterOperator; team?: true }>([
  ...Object.entries(OP_CODES).map(
    ([op, code]) => [code, { op: op as PeopleFilterOperator }] as const,
  ),
  [TEAM_CODES.is, { op: "is", team: true }],
  [TEAM_CODES.is_not, { op: "is_not", team: true }],
]);

const BASE64URL =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 36-character uuid → 22 base64url characters (no padding). */
export const uuidToToken = (uuid: string) => {
  const hex = uuid.replace(/-/g, "").toLowerCase();
  let bits = "";
  for (const char of hex)
    bits += parseInt(char, 16).toString(2).padStart(4, "0");
  bits = bits.padEnd(132, "0");
  let out = "";
  for (let index = 0; index < 132; index += 6) {
    out += BASE64URL[parseInt(bits.slice(index, index + 6), 2)];
  }
  return out;
};

/** The inverse of uuidToToken; null for anything that is not one. */
export const tokenToUuid = (token: string): string | null => {
  if (!/^[A-Za-z0-9_-]{22}$/.test(token)) return null;
  let bits = "";
  for (const char of token) {
    bits += BASE64URL.indexOf(char).toString(2).padStart(6, "0");
  }
  if (!/^0+$/.test(bits.slice(128))) return null;
  let hex = "";
  for (let index = 0; index < 128; index += 4) {
    hex += parseInt(bits.slice(index, index + 4), 2).toString(16);
  }
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

const dateToToken = (iso: string) => iso.replace(/-/g, "");
const tokenToDate = (token: string) =>
  /^\d{8}$/.test(token)
    ? `${token.slice(0, 4)}-${token.slice(4, 6)}-${token.slice(6, 8)}`
    : null;

const encodeCondition = (condition: PeopleFilterCondition) => {
  const field = PEOPLE_FILTER_FIELDS[condition.field];
  const code =
    condition.team && (condition.op === "is" || condition.op === "is_not")
      ? TEAM_CODES[condition.op]
      : OP_CODES[condition.op];
  const args: string[] = [];

  if (condition.op === "is" || condition.op === "is_not") {
    for (const value of condition.values ?? []) {
      args.push(
        field.kind === "ref" || field.kind === "person"
          ? uuidToToken(value)
          : value,
      );
    }
  } else if (condition.op === "between") {
    args.push(dateToToken(condition.from!), dateToToken(condition.to!));
  } else if (condition.op === "before" || condition.op === "after") {
    args.push(dateToToken(condition.from!));
  } else if (condition.op === "next_days") {
    args.push(String(condition.days));
  }

  return [field.urlKey, code, ...args].join(".");
};

/** The `f` parameter of the conditions; "" when there are none. */
export const serializeFilterConditions = (filter: PeopleFilter) =>
  filter.conditions.length === 0
    ? ""
    : [
        PEOPLE_FILTER_URL_VERSION,
        ...coercePeopleFilter(filter).conditions.map(encodeCondition),
      ].join("~");

const decodeCondition = (part: string): unknown => {
  const [key, code, ...args] = part.split(".");
  const field = peopleFilterFieldByUrlKey.get(key ?? "");
  const operator = opByCode.get(code ?? "");

  if (!field || !operator) return null;

  const { op, team } = operator;
  const condition: Record<string, unknown> = { field: field.id, op };

  if (team) condition.team = true;

  if (op === "is" || op === "is_not") {
    condition.values =
      field.kind === "ref" || field.kind === "person"
        ? args.map(tokenToUuid)
        : args;
  } else if (op === "between") {
    condition.from = tokenToDate(args[0] ?? "");
    condition.to = tokenToDate(args[1] ?? "");
  } else if (op === "before" || op === "after") {
    condition.from = tokenToDate(args[0] ?? "");
  } else if (op === "next_days") {
    condition.days = /^\d{1,3}$/.test(args[0] ?? "") ? Number(args[0]) : null;
  }

  // Null fields fail validation and the condition is dropped.
  return Object.fromEntries(
    Object.entries(condition).map(([name, value]) => [
      name,
      value === null ? undefined : value,
    ]),
  ) as unknown;
};

/** Conditions of an `f` parameter; unknown versions and parts are ignored. */
export const parseFilterConditions = (param: string | null | undefined) => {
  if (!param || param.length > MAX_FILTER_PARAM_LENGTH) return [];

  const [version, ...parts] = param.split("~");

  if (version !== PEOPLE_FILTER_URL_VERSION) return [];

  return parts.map(decodeCondition).filter(Boolean);
};

export type PeopleSearchParams = Record<string, string | string[] | undefined>;

const first = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

/**
 * The filter of a Personas URL (page or export). The new `f` wins over the
 * old `status`/`region`/`area`/`site` for the same field.
 */
export const parsePeopleFilterParams = (
  params: PeopleSearchParams | URLSearchParams,
): PeopleFilter => {
  const get = (name: string) =>
    params instanceof URLSearchParams
      ? (params.get(name) ?? undefined)
      : first(params[name]);
  const legacy: unknown[] = [];
  const status = get("status");

  if (status === "activa" || status === "baja") {
    legacy.push({ field: "relacion", op: "is", values: [status] });
  }

  for (const [name, field] of [
    ["region", "region"],
    ["area", "area"],
    ["site", "sucursal"],
  ] as const) {
    const value = get(name);
    if (value && UUID.test(value)) {
      legacy.push({ field, op: "is", values: [value.toLowerCase()] });
    }
  }

  return coercePeopleFilter({
    q: get("q") ?? "",
    deleted: get("deleted") === "1",
    conditions: [...legacy, ...parseFilterConditions(get("f"))],
  });
};

/** The URL parameters that carry a filter (old ones included). */
export const PEOPLE_FILTER_PARAM_NAMES = [
  "q",
  "f",
  "deleted",
  "status",
  "region",
  "area",
  "site",
] as const;

/** True when the URL says anything about the filter (then it beats a view). */
export const hasPeopleFilterParams = (
  params: PeopleSearchParams | URLSearchParams,
) =>
  PEOPLE_FILTER_PARAM_NAMES.some((name) =>
    params instanceof URLSearchParams
      ? params.has(name)
      : first(params[name]) !== undefined,
  );

/**
 * Writes `filter` into `params` (in place): sets q/f/deleted, drops the old
 * parameters. Returns false, without touching `params`, when `f` would be
 * longer than the limit.
 */
export const writePeopleFilterParams = (
  params: URLSearchParams,
  filter: PeopleFilter,
) => {
  const f = serializeFilterConditions(filter);

  if (f.length > MAX_FILTER_PARAM_LENGTH) return false;

  for (const name of PEOPLE_FILTER_PARAM_NAMES) params.delete(name);
  if (filter.q.trim()) params.set("q", filter.q.trim());
  if (f) params.set("f", f);
  if (filter.deleted) params.set("deleted", "1");

  return true;
};

/** The query string for a filter alone (export links, saved views). */
export const peopleFilterQueryString = (filter: PeopleFilter) => {
  const params = new URLSearchParams();
  writePeopleFilterParams(params, filter);
  return params.toString();
};

/** Everything the Personas page reads from its URL. */
export const parsePeopleListParams = (params: PeopleSearchParams) => {
  const { page, pageSize } = parseListPaging({
    page: first(params.page),
    pageSize: first(params.pageSize),
  });
  const view = first(params.view);

  return {
    filter: parsePeopleFilterParams(params),
    hasFilterParams: hasPeopleFilterParams(params),
    page,
    pageSize,
    viewId: view && UUID.test(view) ? view.toLowerCase() : null,
    columns: first(params.cols) ?? null,
  };
};
