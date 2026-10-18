/**
 * Base templates RRHH can add to a company and then edit (WRK-I5-5): a
 * fixed-term contract with a trial period and an open-ended one with the
 * schedule as an annex. They only use tokens of CONTRACT_TEMPLATE_TOKENS.
 */
export const OFFICIAL_TEMPLATES = [
  {
    name: "Contrato individual por tiempo determinado (base oficial)",
    body: `CONTRATO INDIVIDUAL DE TRABAJO POR TIEMPO DETERMINADO

Que celebran por una parte {{empresa_razon_social}} ({{empresa}}), con RFC {{empresa_rfc}}, a quien en lo sucesivo se le denominará «LA EMPRESA», y por la otra {{nombres}} {{apellido_paterno}} {{apellido_materno}}, a quien en lo sucesivo se le denominará «LA PERSONA TRABAJADORA», al tenor de las siguientes declaraciones y cláusulas.

DECLARACIONES

I. LA PERSONA TRABAJADORA declara ser de nacionalidad {{nacionalidad}}, estado civil {{estado_civil}}, con CURP {{curp}}, RFC {{rfc}}, número de seguridad social {{nss}}, clave de elector {{ine}} y domicilio en {{domicilio}}.

II. LA EMPRESA declara que requiere los servicios de LA PERSONA TRABAJADORA por tiempo determinado, en términos del artículo 37 de la Ley Federal del Trabajo.

CLÁUSULAS

PRIMERA. Puesto. LA PERSONA TRABAJADORA prestará sus servicios como {{puesto}} en el área de {{area}}, en {{sucursal}}.

SEGUNDA. Duración. Este contrato tiene vigencia del {{fecha_inicio}} al {{fecha_fin}}. Al vencer terminará sin responsabilidad para las partes, salvo que subsista la materia del trabajo.

TERCERA. Periodo de prueba. Las partes convienen un periodo de prueba de 90 días a partir del {{fecha_inicio}}, durante el cual LA EMPRESA evaluará que LA PERSONA TRABAJADORA cuenta con los requisitos y conocimientos para el puesto.

CUARTA. Jornada. La jornada de trabajo será: {{horario}}.

QUINTA. Salario. LA PERSONA TRABAJADORA percibirá un salario diario de {{salario_diario}} (mensual aproximado de {{salario_mensual}}), pagadero en forma {{periodicidad}} mediante {{forma_pago}}.

SEXTA. Antigüedad. Se reconoce como fecha de ingreso original el {{fecha_ingreso}}.

SÉPTIMA. Lo no previsto en este contrato se regirá por la Ley Federal del Trabajo.

Leído que fue el presente contrato, las partes lo firman de conformidad.

______________________________          ______________________________
LA EMPRESA                               LA PERSONA TRABAJADORA
{{empresa_razon_social}}                 {{nombres}} {{apellido_paterno}} {{apellido_materno}}`,
  },
  {
    name: "Contrato individual por tiempo indeterminado (base oficial)",
    body: `CONTRATO INDIVIDUAL DE TRABAJO POR TIEMPO INDETERMINADO

Que celebran por una parte {{empresa_razon_social}} ({{empresa}}), con RFC {{empresa_rfc}}, a quien en lo sucesivo se le denominará «LA EMPRESA», y por la otra {{nombres}} {{apellido_paterno}} {{apellido_materno}}, a quien en lo sucesivo se le denominará «LA PERSONA TRABAJADORA», al tenor de las siguientes declaraciones y cláusulas.

DECLARACIONES

I. LA PERSONA TRABAJADORA declara ser de nacionalidad {{nacionalidad}}, estado civil {{estado_civil}}, con CURP {{curp}}, RFC {{rfc}}, número de seguridad social {{nss}}, clave de elector {{ine}} y domicilio en {{domicilio}}.

CLÁUSULAS

PRIMERA. Puesto. LA PERSONA TRABAJADORA prestará sus servicios como {{puesto}} en el área de {{area}}, en {{sucursal}}.

SEGUNDA. Duración. Este contrato es por tiempo indeterminado y surte efectos a partir del {{fecha_inicio}}.

TERCERA. Jornada. La jornada de trabajo es la que se detalla en el Anexo A de este contrato.

CUARTA. Salario. LA PERSONA TRABAJADORA percibirá un salario diario de {{salario_diario}} (mensual aproximado de {{salario_mensual}}), pagadero en forma {{periodicidad}} mediante {{forma_pago}}.

QUINTA. Antigüedad. Se reconoce como fecha de ingreso original el {{fecha_ingreso}}; a la firma de este contrato LA PERSONA TRABAJADORA cuenta con una antigüedad de {{antiguedad}}.

SEXTA. Lo no previsto en este contrato se regirá por la Ley Federal del Trabajo.

Leído que fue el presente contrato, las partes lo firman de conformidad.

______________________________          ______________________________
LA EMPRESA                               LA PERSONA TRABAJADORA
{{empresa_razon_social}}                 {{nombres}} {{apellido_paterno}} {{apellido_materno}}

ANEXO A. HORARIO

{{horario}}`,
  },
] as const;
