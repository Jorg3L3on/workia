import { and, desc, eq, isNull } from "drizzle-orm";

import { recordAuditEvent } from "@/lib/audit";
import { getSeniorityCertificate } from "@/lib/contracts";
import { renderContractPdf, renderLetterPdf } from "@/lib/contracts/pdf";
import { contractScheduleText } from "@/lib/contracts/schema";
import { tdb, withTransaction } from "@/lib/db";
import { contracts } from "@/lib/db/schema";
import type { EmployeeContext } from "@/lib/employee-accounts/sign-in";
import { isoToday } from "@/lib/format/date";
import { recordPersonalDataAccess } from "@/lib/privacy";
import { withTenant } from "@/lib/tenant/scope";

/**
 * Contract and constancias in the employee app (Workia 2.0 W2-11). Every read
 * takes the company and person from the employee session, never from the
 * URL; a contract id that is not the session's person is null (a 404). Each
 * download writes one access log row (W2-09) and one audit event with the
 * employee account as the actor, in the same transaction.
 */

/** The employee's contracts, newest first, without the stored text. */
export const listEmployeeContracts = async (context: EmployeeContext) =>
  tdb(context.companyId)
    .select({
      id: contracts.id,
      type: contracts.type,
      status: contracts.status,
      startDate: contracts.startDate,
      endDate: contracts.endDate,
    })
    .from(contracts)
    .where(
      withTenant(
        contracts,
        context.companyId,
        eq(contracts.personId, context.personId),
        isNull(contracts.deletedAt),
      ),
    )
    .orderBy(desc(contracts.startDate), desc(contracts.createdAt));

export type EmployeeContractItem = Awaited<
  ReturnType<typeof listEmployeeContracts>
>[number];

const getOwnContract = async (context: EmployeeContext, contractId: string) => {
  const [contract] = await tdb(context.companyId)
    .select()
    .from(contracts)
    .where(
      withTenant(
        contracts,
        context.companyId,
        and(
          eq(contracts.id, contractId),
          eq(contracts.personId, context.personId),
        ),
        isNull(contracts.deletedAt),
      ),
    )
    .limit(1);

  return contract ?? null;
};

type Download = { file: Buffer; filename: string };

/** The employee's own contract as a PDF, logged; null when it is not theirs. */
export const downloadEmployeeContract = async (
  context: EmployeeContext,
  contractId: string,
): Promise<Download | null> => {
  const contract = await getOwnContract(context, contractId);

  if (!contract) {
    return null;
  }

  // ContractPdfGlyphError propagates; the route answers 422.
  const file = await renderContractPdf({
    generatedText: contract.generatedText,
    scheduleText: contractScheduleText(contract),
  });

  await withTransaction(async (tx) => {
    await recordAuditEvent(
      {
        companyId: context.companyId,
        actorEmployeeAccountId: context.accountId,
        resourceType: "contract",
        resourceId: contract.id,
        action: "export",
        payload: {
          summary: "PDF del contrato (app de empleados)",
          after: { format: "pdf" },
        },
      },
      tx,
    );
    await recordPersonalDataAccess(
      context.companyId,
      {
        personId: context.personId,
        resource: "contract_pdf",
        resourceId: contract.id,
        actorKind: "employee",
      },
      tx,
    );
  }, context.companyId);

  return {
    file,
    filename: `contrato-${contract.startDate}.pdf`,
  };
};

/** Signature lines under the letter, as the contract PDF lays them out. */
const LETTER_SIGNATURES = [
  "",
  "",
  "",
  "______________________________          ______________________________",
  "Nombre y firma de quien expide          Sello",
].join("\n");

/**
 * The employee's seniority letter (constancia de antigüedad) as a PDF, from
 * the same generator HR prints (getSeniorityCertificate), dated today.
 */
export const downloadEmployeeSeniorityLetter = async (
  context: EmployeeContext,
): Promise<Download | null> => {
  const today = isoToday();
  const certificate = await getSeniorityCertificate(
    context.companyId,
    context.personId,
    today,
  );

  if (!certificate || certificate.person.deletedAt) {
    return null;
  }

  const file = await renderLetterPdf({
    title: "Constancia de antigüedad",
    text: `${certificate.text}\n${LETTER_SIGNATURES}`,
  });

  await withTransaction(async (tx) => {
    await recordAuditEvent(
      {
        companyId: context.companyId,
        actorEmployeeAccountId: context.accountId,
        resourceType: "person",
        resourceId: context.personId,
        action: "export",
        payload: {
          summary: "Constancia de antigüedad (app de empleados)",
          after: { format: "pdf", asOf: today },
        },
      },
      tx,
    );
    await recordPersonalDataAccess(
      context.companyId,
      {
        personId: context.personId,
        resource: "seniority_letter",
        resourceId: context.personId,
        actorKind: "employee",
      },
      tx,
    );
  }, context.companyId);

  return { file, filename: `constancia-antiguedad-${today}.pdf` };
};
