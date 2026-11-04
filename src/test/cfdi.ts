import { randomUUID } from "node:crypto";

/**
 * A stamped CFDI 4.0 de nómina with only what W2-03 reads, for tests. Amounts
 * are placeholders the parser ignores.
 */
export const sampleCfdiNomina = (
  options: {
    uuid?: string;
    rfc?: string;
    curp?: string | null;
    numEmpleado?: string | null;
    name?: string;
    periodStart?: string;
    periodEnd?: string;
    paymentDate?: string;
    nominaPrefix?: string;
  } = {},
) => {
  const n = options.nominaPrefix ?? "nomina12";
  const uuid = (options.uuid ?? randomUUID()).toUpperCase();
  const curp =
    options.curp === null
      ? ""
      : ` Curp="${options.curp ?? "PEGJ800101HDFRRN09"}"`;
  const num =
    options.numEmpleado === null
      ? ""
      : ` NumEmpleado="${options.numEmpleado ?? "00123"}"`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<!-- generado por el proveedor -->
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" xmlns:${n}="http://www.sat.gob.mx/nomina12" xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" Version="4.0" Fecha="2026-10-31T10:00:00" SubTotal="0" Total="0" Moneda="MXN" TipoDeComprobante="N" Exportacion="01" LugarExpedicion="64000">
  <cfdi:Emisor Rfc="EKU9003173C9" Nombre="ESCUELA KEMPER URGATE" RegimenFiscal="601"/>
  <cfdi:Receptor Rfc="${options.rfc ?? "PEGJ800101AB1"}" Nombre="${options.name ?? "JUAN PÉREZ GARCÍA &amp; HNOS"}" DomicilioFiscalReceptor="64000" RegimenFiscalReceptor="605" UsoCFDI="CN01"/>
  <cfdi:Conceptos>
    <cfdi:Concepto ClaveProdServ="84111505" Cantidad="1" ClaveUnidad="ACT" Descripcion="Pago de nómina" ValorUnitario="0" Importe="0" ObjetoImp="01"/>
  </cfdi:Conceptos>
  <cfdi:Complemento>
    <${n}:Nomina Version="1.2" TipoNomina="O" FechaPago="${options.paymentDate ?? "2026-10-31"}" FechaInicialPago="${options.periodStart ?? "2026-10-16"}" FechaFinalPago="${options.periodEnd ?? "2026-10-31"}" NumDiasPagados="16">
      <${n}:Emisor RegistroPatronal="B5510768108"/>
      <${n}:Receptor${curp}${num} TipoContrato="01" TipoRegimen="02" PeriodicidadPago="04" ClaveEntFed="NLE"/>
    </${n}:Nomina>
    <tfd:TimbreFiscalDigital Version="1.1" UUID="${uuid}" FechaTimbrado="2026-10-31T10:05:00" RfcProvCertif="SAT970701NN3" SelloCFD="x" NoCertificadoSAT="0" SelloSAT="y"/>
  </cfdi:Complemento>
</cfdi:Comprobante>`;
};

/** The smallest bytes a browser accepts as a PDF, for tests. */
export const samplePdf = () =>
  new TextEncoder().encode("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
