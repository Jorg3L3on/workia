/**
 * Idempotent demo company seed — dummy names and identifiers only.
 */

import { and, eq, isNull } from "drizzle-orm";

import { recordAuditEvent } from "@/lib/audit";
import { fillContractTemplate } from "@/lib/contracts/schema";
import { db } from "@/lib/db";
import { curpCheckDigit, isValidNss } from "@/lib/people/identity";
import { formatHorarioToken } from "@/lib/people/schema";
import {
  activities,
  areas,
  assetMovements,
  assets,
  contractTemplates,
  contracts,
  people,
  personSchedules,
  positionActivities,
  positions,
  sites,
} from "@/lib/db/schema";

const DEMO_MARKER_AREA = "Dirección";

const addDays = (base: Date, days: number) => {
  const copy = new Date(base);
  copy.setDate(copy.getDate() + days);
  return copy.toISOString().slice(0, 10);
};

const subtractDays = (base: Date, days: number) => addDays(base, -days);

// Fake identifiers must be unique per person (active people cannot share a
// CURP or RFC) and pass the same validation as the person form.
const CURP_CONSONANTS = "BCDFGHJKLMNPQRSTVWXZ";

const fakeRfc = (index: number) =>
  `XAXX010101${index.toString(36).toUpperCase().padStart(3, "0")}`;

const fakeCurp = (index: number) => {
  const consonants = [
    index % 20,
    Math.floor(index / 20) % 20,
    Math.floor(index / 400) % 20,
  ]
    .map((digit) => CURP_CONSONANTS[digit])
    .join("");
  const base = `XAXX010101HDF${consonants}0`;

  return `${base}${curpCheckDigit(base)}`;
};

const fakeNss = (index: number) => {
  const body = `9999999${String(index).padStart(3, "0")}`;
  const check = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].find((digit) =>
    isValidNss(`${body}${digit}`),
  );

  return `${body}${check}`;
};

const DEFAULT_TEMPLATE_BODY = `Contrato de trabajo

El presente contrato se celebra con {{nombres}} {{apellido_paterno}} {{apellido_materno}}, RFC {{rfc}}, para desempeñar el puesto de {{puesto}} en el área de {{area}}, con ubicación en {{sucursal}}.

Horario: {{horario}}.

Vigencia: del {{fecha_inicio}} al {{fecha_fin}}.`;

const INDETERMINADO_TEMPLATE_BODY = `Contrato por tiempo indeterminado con {{nombres}} {{apellido_paterno}}, puesto {{puesto}}, área {{area}}, ubicación {{sucursal}}. Horario: {{horario}}. Inicio: {{fecha_inicio}}.`;

const HORARIO_TOKEN = "{{horario}}";

const appendHorarioToken = (body: string) =>
  body.includes(HORARIO_TOKEN)
    ? body
    : `${body.trim()}\n\nHorario: ${HORARIO_TOKEN}.`;

/**
 * Org data for one demo company. `personIndexOffset` shifts the generated
 * names and identifiers so a second demo company does not mirror the first.
 */
export const seedDemoCompany = async (
  companyId: string,
  options: { personIndexOffset?: number } = {},
) => {
  const existing = await db
    .select({ id: areas.id })
    .from(areas)
    .where(
      and(eq(areas.companyId, companyId), eq(areas.name, DEMO_MARKER_AREA)),
    )
    .limit(1);

  if (existing.length > 0) {
    console.log("Demo company already seeded — skipping org data.");
    return;
  }

  const today = new Date();

  const areaNames = [
    "Dirección",
    "RRHH",
    "Finanzas",
    "Operaciones",
    "Comercial",
  ] as const;

  const areaIds = new Map<string, string>();

  for (const name of areaNames) {
    const [area] = await db
      .insert(areas)
      .values({ companyId, name, active: true })
      .returning({ id: areas.id });

    areaIds.set(name, area.id);

    await recordAuditEvent({
      companyId,
      resourceType: "area",
      resourceId: area.id,
      action: "create",
      source: "seed",
      payload: { summary: `Área demo: ${name}` },
    });
  }

  const positionNames = [
    "Jefe de área",
    "Auxiliar ejecutivo",
    "Analista",
    "Coordinador",
  ] as const;

  const positionIds = new Map<string, string>();

  for (const name of positionNames) {
    const [position] = await db
      .insert(positions)
      .values({ companyId, name, active: true })
      .returning({ id: positions.id });

    positionIds.set(name, position.id);

    await recordAuditEvent({
      companyId,
      resourceType: "position",
      resourceId: position.id,
      action: "create",
      source: "seed",
      payload: { summary: `Puesto demo: ${name}` },
    });
  }

  const [corporativo] = await db
    .insert(sites)
    .values({ companyId, name: "Corporativo Demo", kind: "corporativo" })
    .returning({ id: sites.id });

  const [sucursalCentro] = await db
    .insert(sites)
    .values({ companyId, name: "Sucursal Centro Demo", kind: "sucursal" })
    .returning({ id: sites.id });

  const [sucursalNorte] = await db
    .insert(sites)
    .values({ companyId, name: "Sucursal Norte Demo", kind: "sucursal" })
    .returning({ id: sites.id });

  for (const site of [corporativo, sucursalCentro, sucursalNorte]) {
    await recordAuditEvent({
      companyId,
      resourceType: "site",
      resourceId: site.id,
      action: "create",
      source: "seed",
      payload: { summary: "Ubicación demo creada" },
    });
  }

  const firstNames = [
    "Ana",
    "Luis",
    "María",
    "Carlos",
    "Sofía",
    "Diego",
    "Laura",
    "Pedro",
    "Claudia",
    "Roberto",
    "Patricia",
    "Fernando",
    "Gabriela",
    "Héctor",
    "Isabel",
    "Jorge",
    "Karla",
    "Miguel",
    "Natalia",
    "Oscar",
    "Paula",
    "Ricardo",
    "Teresa",
    "Ulises",
    "Valeria",
    "Ximena",
    "Yolanda",
    "Zoe",
  ];

  let personIndex = 1 + (options.personIndexOffset ?? 0);
  let peopleCreated = 0;
  const jefeIds = new Map<string, string>();

  for (const area of areaNames) {
    const areaId = areaIds.get(area)!;
    const jefePositionId = positionIds.get("Jefe de área")!;
    const auxPositionId = positionIds.get("Auxiliar ejecutivo")!;
    const analistaId = positionIds.get("Analista")!;
    const coordinadorId = positionIds.get("Coordinador")!;

    const jefeNombres =
      area === "RRHH" ? "Elena" : firstNames[personIndex % firstNames.length];

    const [jefe] = await db
      .insert(people)
      .values({
        companyId,
        nombres: jefeNombres,
        apellidoPaterno: "Demo",
        apellidoMaterno: area === "RRHH" ? "Ejemplo" : "Muestra",
        email:
          area === "RRHH"
            ? "elena.demo@ejemplo.local"
            : `${area.toLowerCase()}.jefe@ejemplo.local`,
        fechaNacimiento: subtractDays(today, 365 * 38),
        fechaIngreso: subtractDays(today, 900),
        areaId,
        positionId: jefePositionId,
        siteId: corporativo.id,
        rfc: fakeRfc(personIndex),
        curp: fakeCurp(personIndex),
        nss: fakeNss(personIndex),
        status: "activa",
      })
      .returning({ id: people.id });

    jefeIds.set(area, jefe.id);
    personIndex++;
    peopleCreated++;

    await recordAuditEvent({
      companyId,
      resourceType: "person",
      resourceId: jefe.id,
      action: "create",
      source: "seed",
      payload: { summary: `Jefe demo: ${area}` },
    });

    const teamMembers: Array<{
      nombres: string;
      positionId: string;
      siteId: string;
      status: "activa" | "baja";
    }> = [
      {
        nombres: firstNames[(personIndex + 2) % firstNames.length],
        positionId: auxPositionId,
        siteId: area === "Operaciones" ? sucursalNorte.id : corporativo.id,
        status: "activa",
      },
      {
        nombres: firstNames[(personIndex + 4) % firstNames.length],
        positionId: analistaId,
        siteId: sucursalCentro.id,
        status: "activa",
      },
      {
        nombres: firstNames[(personIndex + 6) % firstNames.length],
        positionId: coordinadorId,
        siteId: sucursalNorte.id,
        status: personIndex % 2 === 0 ? "baja" : "activa",
      },
      {
        nombres: firstNames[(personIndex + 8) % firstNames.length],
        positionId: analistaId,
        siteId: corporativo.id,
        status: "activa",
      },
    ];

    for (const member of teamMembers) {
      const [created] = await db
        .insert(people)
        .values({
          companyId,
          nombres: member.nombres,
          apellidoPaterno: "Demo",
          apellidoMaterno: "Ejemplo",
          email: `${member.nombres.toLowerCase()}.demo@ejemplo.local`,
          fechaNacimiento: subtractDays(today, 365 * (26 + (personIndex % 10))),
          fechaIngreso: subtractDays(today, 120 + personIndex * 8),
          areaId,
          positionId: member.positionId,
          managerId: jefe.id,
          siteId: member.siteId,
          rfc: fakeRfc(personIndex),
          curp: fakeCurp(personIndex),
          nss: fakeNss(personIndex),
          status: member.status,
        })
        .returning({ id: people.id });

      personIndex++;
      peopleCreated++;

      await recordAuditEvent({
        companyId,
        resourceType: "person",
        resourceId: created.id,
        action: "create",
        source: "seed",
        payload: { summary: `Persona demo en ${area}` },
      });
    }
  }

  const [determinadoTemplate] = await db
    .insert(contractTemplates)
    .values({
      companyId,
      name: "Contrato determinado demo",
      body: DEFAULT_TEMPLATE_BODY,
      active: true,
    })
    .returning({ id: contractTemplates.id });

  const templateId = determinadoTemplate.id;

  await recordAuditEvent({
    companyId,
    resourceType: "contract_template",
    resourceId: determinadoTemplate.id,
    action: "create",
    source: "seed",
    payload: { summary: "Plantilla demo determinada" },
  });

  const [indeterminadoTemplate] = await db
    .insert(contractTemplates)
    .values({
      companyId,
      name: "Contrato indeterminado demo",
      body: INDETERMINADO_TEMPLATE_BODY,
      active: true,
    })
    .returning({ id: contractTemplates.id });

  const indeterminadoTemplateId = indeterminadoTemplate.id;

  await recordAuditEvent({
    companyId,
    resourceType: "contract_template",
    resourceId: indeterminadoTemplate.id,
    action: "create",
    source: "seed",
    payload: { summary: "Plantilla demo indeterminada" },
  });

  const activePeople = await db
    .select({
      person: people,
      areaName: areas.name,
      positionName: positions.name,
      siteName: sites.name,
    })
    .from(people)
    .leftJoin(areas, eq(people.areaId, areas.id))
    .leftJoin(positions, eq(people.positionId, positions.id))
    .leftJoin(sites, eq(people.siteId, sites.id))
    .where(
      and(
        eq(people.companyId, companyId),
        and(eq(people.status, "activa"), isNull(people.deletedAt)),
      ),
    );

  let contractCount = 0;

  for (const row of activePeople) {
    if (contractCount >= 18) {
      break;
    }

    const isTrustHire = contractCount % 5 === 0;
    const inRenewalWindow = contractCount < 4;

    const startDate = subtractDays(today, 300);
    const endDate = isTrustHire
      ? null
      : inRenewalWindow
        ? addDays(today, 15 + contractCount * 5)
        : addDays(today, 120 + contractCount * 10);

    const type = isTrustHire ? "indeterminado" : "determinado";
    const noticeWindow = isTrustHire
      ? "no_avisar"
      : inRenewalWindow
        ? (["1", "2", "3"][contractCount % 3] as "1" | "2" | "3")
        : "6";

    const body =
      type === "indeterminado"
        ? INDETERMINADO_TEMPLATE_BODY
        : DEFAULT_TEMPLATE_BODY;

    const generatedText = fillContractTemplate(body, {
      nombres: row.person.nombres,
      apellidoPaterno: row.person.apellidoPaterno,
      apellidoMaterno: row.person.apellidoMaterno,
      puesto: row.positionName ?? "",
      area: row.areaName ?? "",
      sucursal: row.siteName ?? "",
      rfc: row.person.rfc,
      horario: formatHorarioToken(null),
      fechaInicio: startDate,
      fechaFin: endDate,
    });

    const [contract] = await db
      .insert(contracts)
      .values({
        companyId,
        personId: row.person.id,
        type,
        startDate,
        endDate,
        noticeWindow,
        templateId:
          type === "indeterminado" ? indeterminadoTemplateId : templateId,
        templateName:
          type === "indeterminado"
            ? "Contrato indeterminado demo"
            : "Contrato determinado demo",
        generatedText,
        status: "vigente",
      })
      .returning({ id: contracts.id });

    await recordAuditEvent({
      companyId,
      resourceType: "contract",
      resourceId: contract.id,
      action: "create",
      source: "seed",
      payload: { summary: "Contrato demo emitido" },
    });

    contractCount++;
  }

  console.log(
    `Demo company seed completed (${areaNames.length} areas, ${peopleCreated} people, ${contractCount} contracts).`,
  );
};

const DEMO_ASSET_MARKER = "LAP-DEMO-001";

export const seedDemoResguardo = async (companyId: string) => {
  const existing = await db
    .select({ id: assets.id })
    .from(assets)
    .where(
      and(
        eq(assets.companyId, companyId),
        eq(assets.identifier, DEMO_ASSET_MARKER),
      ),
    )
    .limit(1);

  if (existing.length > 0) {
    console.log("Demo resguardo already seeded — skipping asset data.");
    return;
  }

  const activePeople = await db
    .select({ id: people.id, nombres: people.nombres })
    .from(people)
    .where(
      and(
        eq(people.companyId, companyId),
        and(eq(people.status, "activa"), isNull(people.deletedAt)),
      ),
    )
    .limit(5);

  if (activePeople.length < 2) {
    console.log(
      "Demo resguardo skipped — need at least 2 active people in expediente.",
    );
    return;
  }

  const [holderA, holderB] = activePeople;
  const today = new Date();

  const [laptopWarehouse] = await db
    .insert(assets)
    .values({
      companyId,
      name: "Laptop demo almacén",
      identifier: DEMO_ASSET_MARKER,
      category: "laptop",
      tracksHistory: true,
      status: "disponible",
    })
    .returning();

  await recordAuditEvent({
    companyId,
    resourceType: "asset",
    resourceId: laptopWarehouse.id,
    action: "create",
    source: "seed",
    payload: { summary: "Activo demo en almacén" },
  });

  const [laptopAssigned] = await db
    .insert(assets)
    .values({
      companyId,
      name: "Laptop demo asignada",
      identifier: "LAP-DEMO-002",
      category: "laptop",
      tracksHistory: true,
      holderId: holderA.id,
      conditionNote: "Buen estado, cargador incluido",
      status: "asignado",
    })
    .returning();

  await db.insert(assetMovements).values({
    companyId,
    assetId: laptopAssigned.id,
    type: "entrega",
    personId: holderA.id,
    movementDate: subtractDays(today, 45),
    conditionNote: "Buen estado, cargador incluido",
  });

  await recordAuditEvent({
    companyId,
    resourceType: "asset",
    resourceId: laptopAssigned.id,
    action: "create",
    source: "seed",
    payload: { summary: "Laptop demo asignada" },
  });

  const [moto] = await db
    .insert(assets)
    .values({
      companyId,
      name: "Motocicleta demo",
      identifier: "MOTO-DEMO-001",
      category: "moto",
      tracksHistory: true,
      holderId: holderB.id,
      conditionNote: "Llanta trasera con desgaste leve",
      status: "asignado",
    })
    .returning();

  await db.insert(assetMovements).values([
    {
      companyId,
      assetId: moto.id,
      type: "entrega",
      personId: holderA.id,
      movementDate: subtractDays(today, 180),
      conditionNote: "Excelente estado, placas vigentes",
    },
    {
      companyId,
      assetId: moto.id,
      type: "devolucion",
      personId: holderA.id,
      movementDate: subtractDays(today, 90),
      conditionNote: "Rayón menor en guardabarros",
    },
    {
      companyId,
      assetId: moto.id,
      type: "entrega",
      personId: holderB.id,
      movementDate: subtractDays(today, 30),
      conditionNote: "Llanta trasera con desgaste leve",
    },
  ]);

  await recordAuditEvent({
    companyId,
    resourceType: "asset",
    resourceId: moto.id,
    action: "create",
    source: "seed",
    payload: { summary: "Motocicleta demo con historial de 2 titulares" },
  });

  const [consumible] = await db
    .insert(assets)
    .values({
      companyId,
      name: "Paquete lápices demo",
      identifier: "CON-DEMO-001",
      category: "consumible",
      tracksHistory: false,
      status: "disponible",
    })
    .returning();

  await recordAuditEvent({
    companyId,
    resourceType: "asset",
    resourceId: consumible.id,
    action: "create",
    source: "seed",
    payload: { summary: "Consumible demo sin historial" },
  });

  const [phone] = await db
    .insert(assets)
    .values({
      companyId,
      name: "Teléfono demo",
      identifier: "TEL-DEMO-001",
      category: "telefono",
      tracksHistory: true,
      status: "disponible",
    })
    .returning();

  await recordAuditEvent({
    companyId,
    resourceType: "asset",
    resourceId: phone.id,
    action: "create",
    source: "seed",
    payload: { summary: "Teléfono demo en almacén" },
  });

  console.log(
    `Demo resguardo seed completed (5 assets, moto with ${holderA.nombres} → devolución → ${holderB.nombres}).`,
  );
};

const DEMO_ACTIVITY_MARKER = "Atención a solicitudes internas";

export const seedDemoActivities = async (companyId: string) => {
  const existing = await db
    .select({ id: activities.id })
    .from(activities)
    .where(
      and(
        eq(activities.companyId, companyId),
        eq(activities.name, DEMO_ACTIVITY_MARKER),
      ),
    )
    .limit(1);

  if (existing.length > 0) {
    console.log("Demo activities already seeded — skipping activity data.");
    return;
  }

  const activityNames = [
    DEMO_ACTIVITY_MARKER,
    "Captura de reportes semanales",
    "Coordinación de turnos demo",
    "Revisión de bitácora diaria",
  ] as const;

  const activityIds = new Map<string, string>();

  for (const name of activityNames) {
    const [activity] = await db
      .insert(activities)
      .values({ companyId, name, active: true })
      .returning({ id: activities.id });

    activityIds.set(name, activity.id);

    await recordAuditEvent({
      companyId,
      resourceType: "activity",
      resourceId: activity.id,
      action: "create",
      source: "seed",
      payload: { summary: `Actividad demo: ${name}` },
    });
  }

  const findPosition = async (name: string) => {
    const [row] = await db
      .select({ id: positions.id, name: positions.name })
      .from(positions)
      .where(
        and(
          eq(positions.companyId, companyId),
          and(eq(positions.name, name), isNull(positions.deletedAt)),
        ),
      )
      .limit(1);

    return row ?? null;
  };

  const analista = await findPosition("Analista");
  const jefe = await findPosition("Jefe de área");

  const assignments: Array<{
    position: { id: string; name: string } | null;
    activityName: (typeof activityNames)[number];
  }> = [
    { position: analista, activityName: DEMO_ACTIVITY_MARKER },
    { position: analista, activityName: "Captura de reportes semanales" },
    { position: jefe, activityName: "Coordinación de turnos demo" },
  ];

  let assignedCount = 0;

  for (const assignment of assignments) {
    const activityId = activityIds.get(assignment.activityName);

    if (!assignment.position || !activityId) {
      continue;
    }

    await db
      .insert(positionActivities)
      .values({
        companyId,
        positionId: assignment.position.id,
        activityId,
      })
      .onConflictDoNothing();

    await recordAuditEvent({
      companyId,
      resourceType: "position_activity",
      resourceId: `${assignment.position.id}:${activityId}`,
      action: "link",
      source: "seed",
      payload: {
        summary: `Actividad demo asignada: ${assignment.activityName} → ${assignment.position.name}`,
      },
    });

    assignedCount++;
  }

  console.log(
    `Demo activities seed completed (${activityNames.length} activities, ${assignedCount} assignments).`,
  );
};

const DEMO_SCHEDULE_PEOPLE = [
  {
    email: "horario.uno@ejemplo.local",
    nombres: "Persona",
    apellidoPaterno: "HorarioUno",
    apellidoMaterno: "Demo",
    rfc: fakeRfc(901),
    curp: fakeCurp(901),
    nss: fakeNss(901),
    schedule: {
      entrada: "08:00",
      salidaComer: "13:00",
      regresoComer: "14:00",
      salida: "17:00",
    },
  },
  {
    email: "horario.dos@ejemplo.local",
    nombres: "Persona",
    apellidoPaterno: "HorarioDos",
    apellidoMaterno: "Demo",
    rfc: fakeRfc(902),
    curp: fakeCurp(902),
    nss: fakeNss(902),
    schedule: {
      entrada: "09:00",
      salidaComer: "14:00",
      regresoComer: "15:00",
      salida: "18:00",
    },
  },
] as const;

export const seedDemoSchedules = async (companyId: string) => {
  const [position] = await db
    .select({ id: positions.id })
    .from(positions)
    .where(
      and(
        eq(positions.companyId, companyId),
        and(eq(positions.name, "Analista"), isNull(positions.deletedAt)),
      ),
    )
    .limit(1);

  const [site] = await db
    .select({ id: sites.id })
    .from(sites)
    .where(
      and(
        eq(sites.companyId, companyId),
        and(eq(sites.name, "Sucursal Centro Demo"), isNull(sites.deletedAt)),
      ),
    )
    .limit(1);

  const [area] = await db
    .select({ id: areas.id })
    .from(areas)
    .where(
      and(
        eq(areas.companyId, companyId),
        and(eq(areas.name, "Operaciones"), isNull(areas.deletedAt)),
      ),
    )
    .limit(1);

  if (!position || !site || !area) {
    console.log(
      "Demo schedules skipped — need Analista, Sucursal Centro Demo and Operaciones.",
    );
    return;
  }

  const demoTemplates = await db
    .select()
    .from(contractTemplates)
    .where(
      and(
        eq(contractTemplates.companyId, companyId),
        isNull(contractTemplates.deletedAt),
      ),
    );

  for (const template of demoTemplates) {
    const nextBody = appendHorarioToken(template.body);

    if (nextBody === template.body) {
      continue;
    }

    await db
      .update(contractTemplates)
      .set({ body: nextBody })
      .where(
        and(
          eq(contractTemplates.companyId, companyId),
          eq(contractTemplates.id, template.id),
        ),
      );
  }

  let peopleReady = 0;

  for (const demo of DEMO_SCHEDULE_PEOPLE) {
    const [existing] = await db
      .select({ id: people.id })
      .from(people)
      .where(and(eq(people.companyId, companyId), eq(people.email, demo.email)))
      .limit(1);

    let personId = existing?.id;

    if (!personId) {
      const [created] = await db
        .insert(people)
        .values({
          companyId,
          nombres: demo.nombres,
          apellidoPaterno: demo.apellidoPaterno,
          apellidoMaterno: demo.apellidoMaterno,
          email: demo.email,
          fechaIngreso: subtractDays(new Date(), 60),
          areaId: area.id,
          positionId: position.id,
          siteId: site.id,
          rfc: demo.rfc,
          curp: demo.curp,
          nss: demo.nss,
          status: "activa",
        })
        .returning({ id: people.id });

      personId = created.id;

      await recordAuditEvent({
        companyId,
        resourceType: "person",
        resourceId: personId,
        action: "create",
        source: "seed",
        payload: {
          summary: `Persona demo de horario: ${demo.apellidoPaterno}`,
        },
      });
    } else {
      await db
        .update(people)
        .set({
          areaId: area.id,
          positionId: position.id,
          siteId: site.id,
          status: "activa",
          deletedAt: null,
        })
        .where(and(eq(people.companyId, companyId), eq(people.id, personId)));
    }

    const [existingSchedule] = await db
      .select({ id: personSchedules.id })
      .from(personSchedules)
      .where(
        and(
          eq(personSchedules.companyId, companyId),
          eq(personSchedules.personId, personId),
        ),
      )
      .limit(1);

    if (existingSchedule) {
      await db
        .update(personSchedules)
        .set({
          entrada: demo.schedule.entrada,
          salidaComer: demo.schedule.salidaComer,
          regresoComer: demo.schedule.regresoComer,
          salida: demo.schedule.salida,
          deletedAt: null,
        })
        .where(
          and(
            eq(personSchedules.companyId, companyId),
            eq(personSchedules.id, existingSchedule.id),
          ),
        );
    } else {
      await db.insert(personSchedules).values({
        companyId,
        personId,
        entrada: demo.schedule.entrada,
        salidaComer: demo.schedule.salidaComer,
        regresoComer: demo.schedule.regresoComer,
        salida: demo.schedule.salida,
      });

      await recordAuditEvent({
        companyId,
        resourceType: "person",
        resourceId: personId,
        action: "create",
        source: "seed",
        payload: {
          summary: "Alta de horario",
          after: {
            entrada: demo.schedule.entrada,
            salidaComer: demo.schedule.salidaComer,
            regresoComer: demo.schedule.regresoComer,
            salida: demo.schedule.salida,
          },
        },
      });
    }

    peopleReady++;
  }

  console.log(
    `Demo schedules seed completed (${peopleReady} people, same Analista + Sucursal Centro Demo).`,
  );
};
