import { randomUUID } from "node:crypto";

import { and, asc, eq, isNull, ne } from "drizzle-orm";

import { recordAuditEvent, snapshotPerson } from "@/lib/audit";
import {
  actInCompany,
  tdb,
  withTransaction,
  type DbTransaction,
} from "@/lib/db";
import { isUniqueViolation } from "@/lib/db/errors";
import {
  areas,
  companies,
  employeeAccounts,
  employmentPeriods,
  people,
  personBeneficiaries,
  personLinks,
  positions,
  sites,
} from "@/lib/db/schema";
import { inviteEmployee } from "@/lib/employee-accounts";
import { formatDateMx } from "@/lib/format/date";
import { logger } from "@/lib/logger";
import {
  EmploymentError,
  isOpenPeriod,
  listEmploymentPeriods,
  recordTermination,
  summarizePeriods,
  syncEmploymentPeriods,
} from "@/lib/people/employment";
import { isValidCurp, normalizeCurp } from "@/lib/people/identity";
import { formatPersonName } from "@/lib/people/schema";
import { seniorityDate } from "@/lib/people/seniority";
import { withTenant } from "@/lib/tenant/scope";
import { appendPersonEvents } from "@/lib/timeline";
import {
  dayInstant,
  employmentAltaEvent,
  employmentTransferEvent,
} from "@/lib/timeline/events";

import { curpsMatch, dayBefore, TRANSFER_COPY } from "./rules";

/**
 * Transfers between subsidiaries of the group (Workia 2.0 W2-24,
 * docs/transfers.md). The rare move of a person to another company: their
 * period in the old company closes as a «traslado», a period opens in the new
 * company on a row of that company (a new one, copied without re-capture, or
 * their earlier row there), and the two rows are linked by id. The CURP of
 * both rows must match. Group seniority carries over as the recognized
 * seniority of the new period. One transaction, row-level security on: each
 * company's rows are written while RLS sees that company.
 */

export { TRANSFER_COPY } from "./rules";

/** A rule refused the transfer; `field` names the form field. */
export class TransferError extends Error {
  constructor(
    message: string,
    public readonly field?: string,
  ) {
    super(message);
    this.name = "TransferError";
  }
}

export type TransferInput = {
  toCompanyId: string;
  /** First day in the new company (yyyy-mm-dd); the old period closes the day before. */
  fechaTraslado: string;
  /** Optional: an existing row of the new company to link to (its CURP must match). */
  toPersonId?: string | null;
  areaId?: string | null;
  positionId?: string | null;
  siteId?: string | null;
  managerId?: string | null;
  comentario?: string | null;
};

export type TransferResult = {
  transferId: string;
  toCompanyId: string;
  toPersonId: string;
  /** The person already had a row in the new company and it was reopened. */
  reusedRow: boolean;
  /** The seniority date the new period counts from (group seniority). */
  fechaAntiguedad: string | null;
  /** The person's employee account email, re-invited in the new company. */
  invitation: { email: string; sent: boolean } | null;
};

/** Personal fields copied to the new company's row: never company dimensions. */
const personalFields = (person: typeof people.$inferSelect) => ({
  nombres: person.nombres,
  apellidoPaterno: person.apellidoPaterno,
  apellidoMaterno: person.apellidoMaterno,
  email: person.email,
  telefono: person.telefono,
  fechaNacimiento: person.fechaNacimiento,
  rfc: person.rfc,
  curp: person.curp,
  nss: person.nss,
  domicilioCalle: person.domicilioCalle,
  domicilioNumeroExterior: person.domicilioNumeroExterior,
  domicilioNumeroInterior: person.domicilioNumeroInterior,
  domicilioColonia: person.domicilioColonia,
  domicilioMunicipio: person.domicilioMunicipio,
  domicilioEstado: person.domicilioEstado,
  domicilioCodigoPostal: person.domicilioCodigoPostal,
  estadoCivil: person.estadoCivil,
  sexo: person.sexo,
  lugarNacimiento: person.lugarNacimiento,
  nacionalidad: person.nacionalidad,
  ineClaveElector: person.ineClaveElector,
});

const lockLivePerson = async (
  tx: DbTransaction,
  companyId: string,
  personId: string,
) => {
  const [person] = await tx
    .select()
    .from(people)
    .where(
      withTenant(
        people,
        companyId,
        eq(people.id, personId),
        isNull(people.deletedAt),
      ),
    )
    .for("update");

  return person ?? null;
};

/** Área, puesto, sucursal and jefe in the new company: live records of that company. */
const assertTargetDimensions = async (
  tx: DbTransaction,
  companyId: string,
  input: TransferInput,
) => {
  const checks = [
    { field: "areaId", id: input.areaId, table: areas },
    { field: "positionId", id: input.positionId, table: positions },
    { field: "siteId", id: input.siteId, table: sites },
  ] as const;

  for (const check of checks) {
    if (!check.id) continue;

    const [found] = await tx
      .select({ id: check.table.id })
      .from(check.table)
      .where(
        withTenant(
          check.table,
          companyId,
          eq(check.table.id, check.id),
          isNull(check.table.deletedAt),
        ),
      )
      .limit(1);

    if (!found) {
      throw new TransferError(TRANSFER_COPY.dimensionNotFound, check.field);
    }
  }

  if (input.managerId) {
    const [manager] = await tx
      .select({ id: people.id })
      .from(people)
      .where(
        withTenant(
          people,
          companyId,
          eq(people.id, input.managerId),
          eq(people.status, "activa"),
          isNull(people.deletedAt),
        ),
      )
      .limit(1);

    if (!manager) {
      throw new TransferError(TRANSFER_COPY.dimensionNotFound, "managerId");
    }
  }
};

/** The row of the new company the person arrives at, if one exists already. */
const findTargetRow = async (
  tx: DbTransaction,
  companyId: string,
  curp: string,
  toPersonId?: string | null,
) => {
  if (toPersonId) {
    return lockLivePerson(tx, companyId, toPersonId).then((row) => {
      if (!row) {
        throw new TransferError(TRANSFER_COPY.targetRowNotFound, "toPersonId");
      }

      return row;
    });
  }

  const [row] = await tx
    .select()
    .from(people)
    .where(
      withTenant(
        people,
        companyId,
        eq(people.curp, curp),
        isNull(people.deletedAt),
      ),
    )
    .for("update");

  return row ?? null;
};

/** RFC or NSS of the person already on another live row of the new company. */
const identityConflictsInTarget = async (
  tx: DbTransaction,
  companyId: string,
  person: Pick<typeof people.$inferSelect, "rfc" | "nss">,
  excludeId?: string,
) => {
  const fields: string[] = [];

  for (const [field, value, column] of [
    ["RFC", person.rfc, people.rfc],
    ["NSS", person.nss, people.nss],
  ] as const) {
    if (!value) continue;

    const [row] = await tx
      .select({ id: people.id })
      .from(people)
      .where(
        withTenant(
          people,
          companyId,
          eq(column, value),
          isNull(people.deletedAt),
          excludeId ? ne(people.id, excludeId) : undefined,
        ),
      )
      .limit(1);

    if (row) fields.push(field);
  }

  return fields;
};

const unique = <T>(promise: Promise<T>, message: string, field?: string) =>
  promise.catch((error: unknown) => {
    if (isUniqueViolation(error)) {
      throw new TransferError(message, field);
    }

    throw error;
  });

/**
 * Moves a person of `companyId` to another company of the group. The caller
 * proves the actor may transfer in both companies (transferPersonAction).
 * Null when the person is not a live row of `companyId`.
 */
export const transferPerson = async (
  companyId: string,
  personId: string,
  input: TransferInput,
  actorUserId: string | null,
  options: {
    /** With an origin, the person's employee account is re-invited in the new company. */
    reinvite?: { origin: string } | null;
  } = {},
): Promise<TransferResult | null> => {
  const toCompanyId = input.toCompanyId;

  if (!toCompanyId || toCompanyId === companyId) {
    throw new TransferError(TRANSFER_COPY.sameCompany, "toCompanyId");
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.fechaTraslado)) {
    throw new TransferError(TRANSFER_COPY.dateRequired, "fechaTraslado");
  }

  const fechaBaja = dayBefore(input.fechaTraslado);

  const outcome = await withTransaction(async (tx) => {
    // ------------------------------------------------- the company they leave
    const source = await lockLivePerson(tx, companyId, personId);

    if (!source) {
      return null;
    }

    if (source.status !== "activa") {
      throw new TransferError(TRANSFER_COPY.notActive);
    }

    const curp = normalizeCurp(source.curp);

    if (!isValidCurp(curp)) {
      throw new TransferError(TRANSFER_COPY.curpMissing, "curp");
    }

    // A person captured before periods existed gets theirs first.
    await syncEmploymentPeriods(tx, companyId, [personId], actorUserId);

    // Everything of the old company is read now, while RLS sees it.
    const [companyRows, sourcePeriods, [sourceAccount], beneficiaries] = [
      await tx
        .select({
          id: companies.id,
          name: companies.name,
          status: companies.status,
          deletedAt: companies.deletedAt,
        })
        .from(companies)
        .orderBy(asc(companies.name)),
      await listEmploymentPeriods(companyId, personId, tx),
      await tx
        .select({ email: employeeAccounts.email })
        .from(employeeAccounts)
        .where(
          withTenant(
            employeeAccounts,
            companyId,
            eq(employeeAccounts.personId, personId),
            ne(employeeAccounts.status, "disabled"),
          ),
        )
        .limit(1),
      await tx
        .select()
        .from(personBeneficiaries)
        .where(
          withTenant(
            personBeneficiaries,
            companyId,
            eq(personBeneficiaries.personId, personId),
          ),
        ),
    ];
    const from = companyRows.find((row) => row.id === companyId);
    const to = companyRows.find((row) => row.id === toCompanyId);

    if (!from || !to || to.status !== "activa" || to.deletedAt) {
      throw new TransferError(TRANSFER_COPY.targetNotFound, "toCompanyId");
    }

    const open = sourcePeriods.find(isOpenPeriod);

    if (!open) {
      throw new TransferError(TRANSFER_COPY.noOpenPeriod);
    }

    if (open.fechaIngreso && input.fechaTraslado <= open.fechaIngreso) {
      throw new TransferError(
        `${TRANSFER_COPY.afterIngreso} (${formatDateMx(open.fechaIngreso)}).`,
        "fechaTraslado",
      );
    }

    // Group seniority: the date the current period counts from.
    const groupSeniority =
      summarizePeriods(sourcePeriods)?.fechaAntiguedad ??
      source.fechaIngreso ??
      null;

    // ------------------------------------------------ the company they join
    await actInCompany(tx, toCompanyId);
    await assertTargetDimensions(tx, toCompanyId, input);

    const existing = await findTargetRow(
      tx,
      toCompanyId,
      curp,
      input.toPersonId,
    );

    if (existing && !curpsMatch(source.curp, existing.curp)) {
      throw new TransferError(TRANSFER_COPY.curpMismatch, "toPersonId");
    }

    if (existing?.status === "activa") {
      throw new TransferError(
        `${formatPersonName(existing)} ${TRANSFER_COPY.alreadyActive} ${to.name}.`,
        "toCompanyId",
      );
    }

    const conflicts = await identityConflictsInTarget(
      tx,
      toCompanyId,
      source,
      existing?.id,
    );

    if (conflicts.length > 0 && !existing) {
      throw new TransferError(
        `${TRANSFER_COPY.identityTaken} ${to.name}: ${conflicts.join(", ")}.`,
      );
    }

    const dims = {
      areaId: input.areaId ?? null,
      positionId: input.positionId ?? null,
      siteId: input.siteId ?? null,
      managerId: input.managerId ?? null,
    };
    let target: typeof people.$inferSelect;
    let targetPeriods: Awaited<ReturnType<typeof listEmploymentPeriods>> = [];

    if (existing) {
      targetPeriods = await listEmploymentPeriods(toCompanyId, existing.id, tx);

      if (targetPeriods.some(isOpenPeriod)) {
        throw new TransferError(
          `${formatPersonName(existing)} ${TRANSFER_COPY.alreadyActive} ${to.name}.`,
          "toCompanyId",
        );
      }

      const last = targetPeriods.at(-1);

      if (last?.fechaBaja && input.fechaTraslado <= last.fechaBaja) {
        throw new TransferError(
          `${TRANSFER_COPY.afterTargetBaja} (${formatDateMx(last.fechaBaja)}).`,
          "fechaTraslado",
        );
      }

      [target] = await tx
        .update(people)
        .set({
          status: "activa",
          fechaIngreso: input.fechaTraslado,
          ...dims,
        })
        .where(withTenant(people, toCompanyId, eq(people.id, existing.id)))
        .returning();
    } else {
      [target] = await unique(
        tx
          .insert(people)
          .values({
            ...personalFields(source),
            curp,
            companyId: toCompanyId,
            status: "activa",
            fechaIngreso: input.fechaTraslado,
            ...dims,
          })
          .returning(),
        `${TRANSFER_COPY.identityTaken} ${to.name}.`,
      );

      if (beneficiaries.length > 0) {
        await tx.insert(personBeneficiaries).values(
          beneficiaries.map((row) => ({
            companyId: toCompanyId,
            personId: target.id,
            nombre: row.nombre,
            parentesco: row.parentesco,
            porcentaje: row.porcentaje,
            orden: row.orden,
          })),
        );
      }
    }

    const fresh = {
      fechaIngreso: input.fechaTraslado,
      reconoceAntiguedad: true,
      fechaAntiguedadReconocida: groupSeniority,
    };
    const [opened] = await unique(
      tx
        .insert(employmentPeriods)
        .values({
          companyId: toCompanyId,
          personId: target.id,
          ...fresh,
          fechaAntiguedad: seniorityDate([...targetPeriods, fresh]),
          createdBy: actorUserId,
        })
        .returning(),
      TRANSFER_COPY.alreadyActive,
    );
    const transferId = randomUUID();
    const occurredAt = dayInstant(input.fechaTraslado);

    await tx.insert(personLinks).values({
      companyId: toCompanyId,
      personId: target.id,
      linkedCompanyId: companyId,
      linkedPersonId: personId,
      transferId,
      direction: "in",
      transferDate: input.fechaTraslado,
      employmentPeriodId: opened.id,
      createdBy: actorUserId,
    });

    await appendPersonEvents(
      toCompanyId,
      [
        employmentAltaEvent(opened, "app", target),
        employmentTransferEvent({
          personId: target.id,
          transferId,
          direction: "in",
          occurredAt,
          source: "app",
          employmentPeriodId: opened.id,
          otherCompanyId: companyId,
          otherPersonId: personId,
        }),
      ],
      tx,
    );

    await recordAuditEvent(
      {
        companyId: toCompanyId,
        actorUserId,
        resourceType: "person",
        resourceId: target.id,
        action: "traslado",
        payload: {
          ...(existing ? { before: snapshotPerson(existing) } : {}),
          after: {
            ...snapshotPerson(target),
            fechaAntiguedad: opened.fechaAntiguedad,
            transferId,
            fromCompanyId: companyId,
            fromPersonId: personId,
          },
          // No área, puesto, sucursal or jefe here: the alta event holds
          // them, and the timeline backfill would read them as a «cambio».
          changes: {
            status: { from: existing?.status ?? null, to: "activa" },
            fechaIngreso: {
              from: existing?.fechaIngreso ?? null,
              to: input.fechaTraslado,
            },
            fechaAntiguedad: { from: null, to: opened.fechaAntiguedad },
          },
          summary: [
            `Traslado desde ${from.name} el ${formatDateMx(input.fechaTraslado)}`,
            existing ? "reabre su expediente" : "expediente nuevo",
            opened.fechaAntiguedad
              ? `antigüedad del grupo desde ${formatDateMx(opened.fechaAntiguedad)}`
              : null,
          ]
            .filter(Boolean)
            .join(" · "),
        },
      },
      tx,
    );

    // ------------------------------------------- back to the company they left
    await actInCompany(tx, companyId);

    const closed = await recordTermination(
      tx,
      companyId,
      personId,
      {
        fechaBaja,
        // Ignored for a transfer: the period closes as «traslado».
        tipoBaja: "otra",
        motivoBajaId: "",
        recontratable: true,
        comentario: input.comentario ?? null,
      },
      actorUserId,
      { transfer: { toCompanyName: to.name } },
    ).catch((error: unknown) => {
      if (error instanceof EmploymentError) {
        throw new TransferError(error.message, error.field);
      }

      throw error;
    });

    if (!closed) {
      return null;
    }

    await tx.insert(personLinks).values({
      companyId,
      personId,
      linkedCompanyId: toCompanyId,
      linkedPersonId: target.id,
      transferId,
      direction: "out",
      transferDate: input.fechaTraslado,
      employmentPeriodId: closed.period.id,
      createdBy: actorUserId,
    });

    await appendPersonEvents(
      companyId,
      [
        employmentTransferEvent({
          personId,
          transferId,
          direction: "out",
          occurredAt,
          source: "app",
          employmentPeriodId: closed.period.id,
          otherCompanyId: toCompanyId,
          otherPersonId: target.id,
        }),
      ],
      tx,
    );

    return {
      transferId,
      toCompanyId,
      toPersonId: target.id,
      reusedRow: Boolean(existing),
      fechaAntiguedad: opened.fechaAntiguedad,
      accountEmail: sourceAccount?.email ?? null,
    };
  }, companyId);

  if (!outcome) {
    return null;
  }

  const { accountEmail, ...result } = outcome;
  let invitation: TransferResult["invitation"] = null;

  // The old account went off with the baja; the new row gets an invitation
  // to the same email, which the baja just freed (docs/identity-model.md).
  if (accountEmail && options.reinvite) {
    try {
      const invited = await inviteEmployee(
        toCompanyId,
        result.toPersonId,
        accountEmail,
        actorUserId,
        { origin: options.reinvite.origin },
      );

      invitation = {
        email: accountEmail,
        sent: Boolean(invited?.ok && invited.emailSent),
      };
    } catch (error) {
      logger.error(
        { err: error, companyId: toCompanyId },
        "Re-invitation after a transfer failed",
      );
      invitation = { email: accountEmail, sent: false };
    }
  }

  return { ...result, invitation };
};

/** The links of one row, newest first, under its company's RLS. */
export const listPersonLinks = async (companyId: string, personId: string) =>
  tdb(companyId)
    .select({
      id: personLinks.id,
      transferId: personLinks.transferId,
      direction: personLinks.direction,
      transferDate: personLinks.transferDate,
      linkedCompanyId: personLinks.linkedCompanyId,
      linkedPersonId: personLinks.linkedPersonId,
      linkedCompanyName: companies.name,
    })
    .from(personLinks)
    .innerJoin(companies, eq(companies.id, personLinks.linkedCompanyId))
    .where(
      and(
        withTenant(personLinks, companyId),
        eq(personLinks.personId, personId),
      ),
    )
    .orderBy(asc(personLinks.transferDate), asc(personLinks.createdAt));

export type PersonLinkRow = Awaited<ReturnType<typeof listPersonLinks>>[number];
