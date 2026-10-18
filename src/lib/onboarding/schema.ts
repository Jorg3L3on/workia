import { z } from "zod";

/** The documents of a hiring (alta), in the order HR checks them (WRK-I5-7). */
export const ONBOARDING_CHECKLIST = [
  "ine",
  "curp",
  "comprobante_domicilio",
  "nss",
  "constancia_fiscal",
  "cuenta_bancaria",
  "contrato_firmado",
] as const;

export type OnboardingChecklistItem = (typeof ONBOARDING_CHECKLIST)[number];

export const onboardingChecklistLabels: Record<
  OnboardingChecklistItem,
  string
> = {
  ine: "INE",
  curp: "CURP",
  comprobante_domicilio: "Comprobante de domicilio",
  nss: "NSS",
  constancia_fiscal: "RFC / constancia de situación fiscal",
  cuenta_bancaria: "Cuenta bancaria",
  contrato_firmado: "Contrato firmado",
};

export const onboardingStageLabels = {
  rh_captura: "Captura RH",
  pendiente_nominas: "Pendiente Nóminas",
  completo: "Completo",
  rechazado: "Rechazado",
} as const;

export const INFONAVIT_DISCOUNT_TYPES = [
  "porcentaje",
  "cuota_fija",
  "veces_salario_minimo",
] as const;

export const infonavitDiscountLabels: Record<
  (typeof INFONAVIT_DISCOUNT_TYPES)[number],
  string
> = {
  porcentaje: "Porcentaje",
  cuota_fija: "Cuota fija",
  veces_salario_minimo: "Veces salario mínimo",
};

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => value || null);

const optionalNumber = z
  .union([z.literal(""), z.coerce.number().min(0).max(1_000_000)])
  .optional()
  .transform((value) => (typeof value === "number" ? value : null));

/** What HR (and Payroll, before approving) capture on an alta. */
export const onboardingFormSchema = z
  .object({
    checklist: z
      .partialRecord(z.enum(ONBOARDING_CHECKLIST), z.boolean())
      .default({}),
    infonavitCredito: optionalText(40),
    infonavitTipoDescuento: z
      .union([z.enum(INFONAVIT_DISCOUNT_TYPES), z.literal("")])
      .optional()
      .transform((value) => value || null),
    infonavitFactor: optionalNumber,
    fonacotCredito: optionalText(40),
    fonacotDescuento: optionalNumber,
  })
  .superRefine((data, ctx) => {
    if (data.infonavitCredito && !data.infonavitTipoDescuento) {
      ctx.addIssue({
        code: "custom",
        message: "Indica el tipo de descuento de Infonavit.",
        path: ["infonavitTipoDescuento"],
      });
    }

    if (data.infonavitCredito && data.infonavitFactor === null) {
      ctx.addIssue({
        code: "custom",
        message: "Indica el factor de descuento de Infonavit.",
        path: ["infonavitFactor"],
      });
    }

    if (data.fonacotCredito && data.fonacotDescuento === null) {
      ctx.addIssue({
        code: "custom",
        message: "Indica el descuento de Fonacot.",
        path: ["fonacotDescuento"],
      });
    }
  });

export type OnboardingFormValues = z.infer<typeof onboardingFormSchema>;

/** Checklist items still missing. */
export const missingChecklist = (
  checklist: Partial<Record<string, boolean>> | null | undefined,
) => ONBOARDING_CHECKLIST.filter((item) => !checklist?.[item]);
