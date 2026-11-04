/**
 * Reads the identifiers of a CFDI de nómina (W2-03) without a dependency: the
 * UUID of the timbre, the receptor's RFC and name, and from the nómina 1.2
 * complement the CURP, NumEmpleado, TipoNomina and the payment dates. Nothing
 * about amounts is read, because Workia never stores them. It does not
 * validate the CFDI against SAT (out of scope); the provider stamped it.
 *
 * Prefixes are resolved through the xmlns declarations, so a provider that
 * writes `n12:` instead of `nomina12:` still parses.
 */

const NS = {
  cfdi: [
    "http://www.sat.gob.mx/cfd/4",
    "http://www.sat.gob.mx/cfd/3",
  ] as readonly string[],
  nomina: ["http://www.sat.gob.mx/nomina12"] as readonly string[],
  tfd: ["http://www.sat.gob.mx/TimbreFiscalDigital"] as readonly string[],
};

/** CFDI XML larger than this is not a nómina receipt. */
export const CFDI_XML_MAX_BYTES = 512 * 1024;

export type CfdiNomina = {
  uuid: string;
  emisorRfc: string | null;
  receptorRfc: string;
  receptorName: string | null;
  curp: string | null;
  numEmpleado: string | null;
  tipoNomina: "O" | "E" | null;
  paymentDate: string | null;
  periodStart: string | null;
  periodEnd: string | null;
};

export type CfdiParseError =
  "not_cfdi" | "not_nomina" | "no_uuid" | "no_receptor";

export const cfdiParseErrorLabels: Record<CfdiParseError, string> = {
  not_cfdi: "El XML no es un CFDI.",
  not_nomina: "El CFDI no trae el complemento de nómina 1.2.",
  no_uuid: "El CFDI no está timbrado (falta el UUID del timbre).",
  no_receptor: "El CFDI no trae el RFC del receptor.",
};

type Tag = { ns: string | null; name: string; attrs: Map<string, string> };

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

const decode = (value: string) =>
  value.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (whole, entity: string) => {
    if (entity[0] === "#") {
      const code =
        entity[1] === "x" || entity[1] === "X"
          ? Number.parseInt(entity.slice(2), 16)
          : Number.parseInt(entity.slice(1), 10);

      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }

    return ENTITIES[entity] ?? whole;
  });

const ATTRIBUTE = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
const START_TAG = /<([A-Za-z_][\w.-]*)(?::([\w.-]+))?(\s[^<>]*?)?\/?>/g;

/** Start tags with their resolved namespace, in document order. */
const readTags = (xml: string): Tag[] => {
  const body = xml
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<\?[\s\S]*?\?>/g, "");
  const prefixes = new Map<string, string>();
  const tags: {
    prefix: string | null;
    name: string;
    attrs: Map<string, string>;
  }[] = [];

  for (const match of body.matchAll(START_TAG)) {
    const [, first, second, rawAttrs = ""] = match;
    const prefix = second ? first : null;
    const name = second ?? first;
    const attrs = new Map<string, string>();

    for (const attr of rawAttrs.matchAll(ATTRIBUTE)) {
      const value = decode(attr[2] ?? attr[3] ?? "");

      if (attr[1].startsWith("xmlns:")) {
        prefixes.set(attr[1].slice(6), value);
      } else if (attr[1] === "xmlns") {
        prefixes.set("", value);
      } else {
        attrs.set(attr[1], value);
      }
    }

    tags.push({ prefix, name, attrs });
  }

  // CFDI declares every namespace on the root, so one map is enough.
  return tags.map((tag) => ({
    ns: prefixes.get(tag.prefix ?? "") ?? null,
    name: tag.name,
    attrs: tag.attrs,
  }));
};

const find = (tags: Tag[], namespaces: readonly string[], name: string) =>
  tags.find((tag) => tag.name === name && namespaces.includes(tag.ns ?? ""));

const clean = (value: string | undefined, max: number) => {
  const trimmed = value?.trim().replace(/\s+/g, " ");

  return trimmed ? trimmed.slice(0, max) : null;
};

const ISO_DATE = /^(\d{4}-\d{2}-\d{2})/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CURP = /^[A-Z][AEIOUX][A-Z]{2}\d{6}[HMX][A-Z]{5}[0-9A-Z]\d$/;

const isoDate = (value: string | undefined) =>
  value?.trim().match(ISO_DATE)?.[1] ?? null;

export const parseCfdiNomina = (
  xml: string,
): { ok: true; value: CfdiNomina } | { ok: false; error: CfdiParseError } => {
  const tags = readTags(xml);
  const comprobante = find(tags, NS.cfdi, "Comprobante");

  if (!comprobante) {
    return { ok: false, error: "not_cfdi" };
  }

  const nomina = find(tags, NS.nomina, "Nomina");

  if (comprobante.attrs.get("TipoDeComprobante") !== "N" || !nomina) {
    return { ok: false, error: "not_nomina" };
  }

  const uuid = find(tags, NS.tfd, "TimbreFiscalDigital")
    ?.attrs.get("UUID")
    ?.trim()
    .toLowerCase();

  if (!uuid || !UUID.test(uuid)) {
    return { ok: false, error: "no_uuid" };
  }

  const receptor = find(tags, NS.cfdi, "Receptor");
  const receptorRfc = clean(receptor?.attrs.get("Rfc"), 13)?.toUpperCase();

  if (!receptorRfc) {
    return { ok: false, error: "no_receptor" };
  }

  const nominaReceptor = find(tags, NS.nomina, "Receptor");
  const curp = clean(nominaReceptor?.attrs.get("Curp"), 18)?.toUpperCase();
  const tipo = nomina.attrs.get("TipoNomina");

  return {
    ok: true,
    value: {
      uuid,
      emisorRfc:
        clean(
          find(tags, NS.cfdi, "Emisor")?.attrs.get("Rfc"),
          13,
        )?.toUpperCase() ?? null,
      receptorRfc,
      receptorName: clean(receptor?.attrs.get("Nombre"), 254),
      curp: curp && CURP.test(curp) ? curp : null,
      numEmpleado: clean(nominaReceptor?.attrs.get("NumEmpleado"), 15),
      tipoNomina: tipo === "O" || tipo === "E" ? tipo : null,
      paymentDate: isoDate(nomina.attrs.get("FechaPago")),
      periodStart: isoDate(nomina.attrs.get("FechaInicialPago")),
      periodEnd: isoDate(nomina.attrs.get("FechaFinalPago")),
    },
  };
};

/** SAT's generic RFCs say nothing about who the person is. */
export const GENERIC_RFCS = new Set(["XAXX010101000", "XEXX010101000"]);
