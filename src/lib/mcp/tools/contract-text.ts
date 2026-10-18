import { templateTokenValues } from "@/lib/contracts/schema";
import { formatMexicanAddress } from "@/lib/people/schema";

import { maskText } from "../mask";
import type { WorkiaToolContext } from "../run-tool";
import { compensationVisible } from "./compensation";

type PersonSecrets = {
  rfc?: string | null;
  curp?: string | null;
  nss?: string | null;
  ineClaveElector?: string | null;
  domicilioCalle?: string | null;
  domicilioNumeroExterior?: string | null;
  domicilioNumeroInterior?: string | null;
  domicilioColonia?: string | null;
  domicilioMunicipio?: string | null;
  domicilioEstado?: string | null;
  domicilioCodigoPostal?: string | null;
} | null;

type CompensationSecrets = {
  salarioDiario?: string | null;
  salarioMensual?: string | null;
} | null;

const replaceAll = (text: string, value: string | null, mask: string) =>
  value ? text.split(value).join(mask) : text;

/**
 * A contract's text as the connection may see it (WRK-I1-12): identifiers
 * (RFC, CURP, NSS, INE) masked and the address hidden without pii, and the
 * salary amounts hidden without pii + compensation:read.
 */
export const maskContractText = (
  text: string,
  ctx: WorkiaToolContext,
  person: PersonSecrets,
  compensation?: CompensationSecrets,
) => {
  let result = text;

  if (!compensationVisible(ctx) && compensation) {
    const values = templateTokenValues({
      nombres: "",
      apellidoPaterno: "",
      fechaInicio: "",
      salarioDiario: compensation.salarioDiario,
      salarioMensual: compensation.salarioMensual,
    });
    result = replaceAll(result, values.salario_diario, "[salario oculto]");
    result = replaceAll(result, values.salario_mensual, "[salario oculto]");
  }

  if (ctx.piiUnmasked || !person) {
    return result;
  }

  result = replaceAll(
    result,
    formatMexicanAddress(person),
    "[domicilio protegido]",
  );

  return maskText(result, [
    person.rfc,
    person.curp,
    person.nss,
    person.ineClaveElector,
  ]);
};
