/**
 * Idempotent demo company seed — dummy names and identifiers only.
 */

import { and, eq, isNull } from "drizzle-orm";

import { recordAuditEvent } from "@/lib/audit";
import { fillContractTemplate } from "@/lib/contracts/schema";
import { db } from "@/lib/db";
import {
  areas,
  contractTemplates,
  contracts,
  people,
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

const fakeRfc = (index: number) =>
  `XAXX01010${String(index).padStart(1, "0")}000`.slice(0, 13);

const fakeCurp = (index: number) =>
  `XAXX010101HDFXXX${String(index).padStart(2, "0")}`.slice(0, 18);

const fakeNss = (index: number) =>
  `999999999${String(index).padStart(2, "0")}`.slice(0, 11);

const DEFAULT_TEMPLATE_BODY = `Contrato de trabajo

El presente contrato se celebra con {{nombres}} {{apellido_paterno}} {{apellido_materno}}, RFC {{rfc}}, para desempeñar el puesto de {{puesto}} en el área de {{area}}, con ubicación en {{sucursal}}.

Vigencia: del {{fecha_inicio}} al {{fecha_fin}}.`;

const INDETERMINADO_TEMPLATE_BODY = `Contrato por tiempo indeterminado con {{nombres}} {{apellido_paterno}}, puesto {{puesto}}, área {{area}}, ubicación {{sucursal}}. Inicio: {{fecha_inicio}}.`;

export const seedDemoCompany = async () => {
  const existing = await db
    .select({ id: areas.id })
    .from(areas)
    .where(eq(areas.name, DEMO_MARKER_AREA))
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
      .values({ name, active: true })
      .returning({ id: areas.id });

    areaIds.set(name, area.id);

    await recordAuditEvent({
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
      .values({ name, active: true })
      .returning({ id: positions.id });

    positionIds.set(name, position.id);

    await recordAuditEvent({
      resourceType: "position",
      resourceId: position.id,
      action: "create",
      source: "seed",
      payload: { summary: `Puesto demo: ${name}` },
    });
  }

  const [corporativo] = await db
    .insert(sites)
    .values({ name: "Corporativo Demo", kind: "corporativo" })
    .returning({ id: sites.id });

  const [sucursalCentro] = await db
    .insert(sites)
    .values({ name: "Sucursal Centro Demo", kind: "sucursal" })
    .returning({ id: sites.id });

  const [sucursalNorte] = await db
    .insert(sites)
    .values({ name: "Sucursal Norte Demo", kind: "sucursal" })
    .returning({ id: sites.id });

  for (const site of [corporativo, sucursalCentro, sucursalNorte]) {
    await recordAuditEvent({
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

  let personIndex = 1;
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
      name: "Contrato determinado demo",
      body: DEFAULT_TEMPLATE_BODY,
      active: true,
    })
    .returning({ id: contractTemplates.id });

  const templateId = determinadoTemplate.id;

  await recordAuditEvent({
    resourceType: "contract_template",
    resourceId: determinadoTemplate.id,
    action: "create",
    source: "seed",
    payload: { summary: "Plantilla demo determinada" },
  });

  const [indeterminadoTemplate] = await db
    .insert(contractTemplates)
    .values({
      name: "Contrato indeterminado demo",
      body: INDETERMINADO_TEMPLATE_BODY,
      active: true,
    })
    .returning({ id: contractTemplates.id });

  const indeterminadoTemplateId = indeterminadoTemplate.id;

  await recordAuditEvent({
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
    .where(and(eq(people.status, "activa"), isNull(people.deletedAt)));

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
      fechaInicio: startDate,
      fechaFin: endDate,
    });

    const [contract] = await db
      .insert(contracts)
      .values({
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
