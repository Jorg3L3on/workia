import { CompanyField } from "@/components/tenant/company-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import type { OnboardingIntake } from "@/lib/db/schema";
import { ONBOARDING_INTAKE_RETURN_REASONS } from "@/lib/db/schema/onboarding-intakes";
import { formatDateTimeMx } from "@/lib/format/date";
import {
  applyIntakeAction,
  returnIntakeAction,
} from "@/lib/onboarding/intake-actions";
import {
  countIntakeFields,
  formatIntakeValue,
  INTAKE_FIELDS,
  intakeReturnReasonLabels,
  intakeShare,
  intakeStatusLabels,
  readIntakeData,
} from "@/lib/onboarding/intake-schema";

import { SelfServiceInvite } from "./self-service-invite";

type StoredValues = Record<string, unknown> & {
  beneficiarios?: { nombre: string; parentesco: string; porcentaje: number }[];
};

const beneficiaryText = (
  list: {
    nombre: string;
    parentesco: string;
    porcentaje: number | string;
  }[] = [],
) =>
  list
    .map((item) => `${item.nombre} (${item.parentesco}, ${item.porcentaje} %)`)
    .join("; ");

/**
 * «Autoservicio» on the alta (W2-10): HR invites the new hire, then reviews
 * what they sent next to what the expediente holds, and applies it or sends
 * it back. It lives inside the «Captura RH» stage: the HR approval waits for
 * a decision on what was sent.
 */
export const SelfServiceCard = ({
  onboardingId,
  altaOpen,
  canHr,
  intake,
  stored,
  defaultEmail,
  hasActiveAccount,
}: {
  onboardingId: string;
  /** The alta is in «Captura RH». */
  altaOpen: boolean;
  canHr: boolean;
  intake: OnboardingIntake | null;
  stored: StoredValues;
  defaultEmail: string;
  hasActiveAccount: boolean;
}) => {
  if (!intake && !(altaOpen && canHr)) return null;

  const data = intake ? readIntakeData(intake.data) : {};
  const counted = countIntakeFields(data);
  const reviewing = intake?.status === "enviado" && altaOpen;

  return (
    <section
      aria-labelledby="autoservicio"
      className="workia-pass-card space-y-4 p-5"
      data-testid="self-service"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold" id="autoservicio">
          Autoservicio de la persona
        </h2>
        {intake ? (
          <Badge tone={intake.status === "enviado" ? "warning" : "neutral"}>
            {intakeStatusLabels[intake.status]}
          </Badge>
        ) : null}
      </div>

      {!intake ? (
        <p className="text-muted-foreground text-sm">
          La persona llena desde su teléfono sus datos personales, domicilio y
          beneficiarios, y sube sus documentos. Tú los revisas aquí y los
          aplicas al expediente.
        </p>
      ) : (
        <p className="text-muted-foreground text-sm">
          Invitada el {formatDateTimeMx(intake.invitedAt)}
          {intake.submittedAt
            ? ` · enviado el ${formatDateTimeMx(intake.submittedAt)}`
            : ""}
          {intake.status === "devuelto" && intake.returnReason
            ? ` · devuelto: ${intakeReturnReasonLabels[intake.returnReason]}`
            : ""}
        </p>
      )}

      {intake?.status === "aplicado" &&
      intake.fieldsTotal !== null &&
      intake.fieldsByEmployee !== null ? (
        <p className="text-sm font-medium" data-testid="self-service-share">
          {intake.fieldsByEmployee} de {intake.fieldsTotal} campos los llenó la
          persona (
          {intakeShare({
            filled: intake.fieldsByEmployee,
            total: intake.fieldsTotal,
          })}{" "}
          %).
        </p>
      ) : null}

      {altaOpen &&
      canHr &&
      (!intake ||
        intake.status === "invitado" ||
        intake.status === "devuelto") ? (
        <SelfServiceInvite
          defaultEmail={defaultEmail}
          hasActiveAccount={hasActiveAccount}
          onboardingId={onboardingId}
          opened={Boolean(intake)}
        />
      ) : null}

      {reviewing ? (
        <>
          <p className="text-sm">
            La persona llenó {counted.filled} de {counted.total} campos (
            {intakeShare(counted)} %). Lo que envió reemplaza el dato del
            expediente; un campo vacío deja el que ya hay.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="self-service-review">
              <thead>
                <tr className="text-muted-foreground border-b text-left">
                  <th className="py-2 pr-3 font-medium" scope="col">
                    Campo
                  </th>
                  <th className="py-2 pr-3 font-medium" scope="col">
                    Envió la persona
                  </th>
                  <th className="py-2 font-medium" scope="col">
                    En el expediente
                  </th>
                </tr>
              </thead>
              <tbody>
                {INTAKE_FIELDS.map((field) => {
                  const sent = formatIntakeValue(field.key, data[field.key]);
                  const current = formatIntakeValue(
                    field.key,
                    stored[field.key],
                  );
                  return (
                    <tr className="border-b last:border-0" key={field.key}>
                      <th
                        className="py-2 pr-3 text-left font-normal"
                        scope="row"
                      >
                        {field.label}
                      </th>
                      <td className="py-2 pr-3 font-medium break-words">
                        {sent || (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="text-muted-foreground py-2 break-words">
                        {current || "—"}
                      </td>
                    </tr>
                  );
                })}
                <tr>
                  <th className="py-2 pr-3 text-left font-normal" scope="row">
                    Beneficiarios
                  </th>
                  <td className="py-2 pr-3 font-medium break-words">
                    {beneficiaryText(data.beneficiarios) || (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="text-muted-foreground py-2 break-words">
                    {beneficiaryText(stored.beneficiarios) || "—"}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {canHr ? (
            <div className="flex flex-wrap items-end justify-end gap-3">
              <form
                action={returnIntakeAction.bind(null, onboardingId)}
                className="flex flex-wrap items-end gap-2"
              >
                <CompanyField />
                <div className="space-y-1">
                  <Label htmlFor="self-service-return">Devolver porque</Label>
                  <select
                    className="border-input h-8 rounded-lg border bg-transparent px-2.5 text-sm"
                    defaultValue=""
                    id="self-service-return"
                    name="motivo"
                    required
                  >
                    <option disabled value="">
                      Elige el motivo
                    </option>
                    {ONBOARDING_INTAKE_RETURN_REASONS.map((reason) => (
                      <option key={reason} value={reason}>
                        {intakeReturnReasonLabels[reason]}
                      </option>
                    ))}
                  </select>
                </div>
                <Button type="submit" variant="secondary">
                  Devolver a la persona
                </Button>
              </form>
              <form action={applyIntakeAction.bind(null, onboardingId)}>
                <CompanyField />
                <Button type="submit">Aplicar al expediente</Button>
              </form>
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
};
