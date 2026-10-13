import { and, asc, eq, isNull, sql } from "drizzle-orm";

import { recordAuditEvent } from "@/lib/audit";
import { db } from "@/lib/db";
import { companies, type CompanyStatus } from "@/lib/db/schema";

/** The company migration 0015 creates; every pre-multi-company row belongs to it. */
export const DEFAULT_COMPANY = {
  name: "Ferretera Mandiola",
  slug: "ferretera-mandiola",
} as const;

/** Where demo data and demo accounts live (seed), apart from real companies. */
export const DEMO_COMPANY = {
  name: "Empresa Demo",
  slug: "empresa-demo",
  legalName: "Empresa Demo, S.A. de C.V.",
} as const;

export const getCompanyBySlug = async (slug: string) => {
  const [company] = await db
    .select()
    .from(companies)
    .where(eq(companies.slug, slug))
    .limit(1);

  return company ?? null;
};

/** The company with `slug`, created if missing (seeds and scripts). */
export const ensureCompany = async (input: {
  name: string;
  slug: string;
  legalName?: string | null;
}) => {
  await db
    .insert(companies)
    .values({ name: input.name, slug: input.slug, legalName: input.legalName })
    .onConflictDoNothing({ target: companies.slug });

  const company = await getCompanyBySlug(input.slug);

  if (!company) {
    throw new Error(`Company ${input.slug} could not be created`);
  }

  return company;
};

/** For scripts: `--company <slug>` (else `fallbackSlug`) → its id. */
export const companyIdFromArgs = async (
  argv: string[] = process.argv,
  fallbackSlug: string = DEFAULT_COMPANY.slug,
) => {
  const index = argv.indexOf("--company");
  const slug = index >= 0 ? argv[index + 1] : fallbackSlug;
  const company = await getCompanyBySlug(slug);

  if (!company) {
    throw new Error(`No company with slug "${slug}"`);
  }

  return company.id;
};

/** A company change the platform cannot make; the message is ready to show. */
export class CompanyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CompanyError";
  }
}

export type CompanyInput = {
  name: string;
  slug: string;
  legalName?: string | null;
  rfc?: string | null;
};

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** "Ferretera Mandiola" -> "ferretera-mandiola". */
export const slugify = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const normalizeInput = (input: CompanyInput) => {
  const name = input.name.trim();
  const slug = (input.slug.trim() || slugify(name)).toLowerCase();

  if (!name) {
    throw new CompanyError("Escribe el nombre comercial.");
  }

  if (!SLUG_PATTERN.test(slug)) {
    throw new CompanyError(
      "El identificador solo admite minúsculas, números y guiones (ej. ferretera-mandiola).",
    );
  }

  return {
    name,
    slug,
    legalName: input.legalName?.trim() || null,
    rfc: input.rfc?.trim().toUpperCase() || null,
  };
};

const auditCompany = (
  company: { id: string; name: string },
  actorUserId: string,
  action: "create" | "update" | "activate" | "deactivate",
  summary: string,
  after: Record<string, unknown>,
) =>
  // Platform events are recorded in the company they affect.
  recordAuditEvent({
    companyId: company.id,
    actorUserId,
    resourceType: "company",
    resourceId: company.id,
    action,
    payload: { summary, after },
  });

export const listCompaniesWithCounts = async () =>
  db
    .select({
      id: companies.id,
      name: companies.name,
      legalName: companies.legalName,
      rfc: companies.rfc,
      slug: companies.slug,
      status: companies.status,
      createdAt: companies.createdAt,
      // Qualified by hand: inside the subquery a bare "id" would be the membership's.
      members: sql<number>`(
        select count(*)::int from "company_memberships" m
        where m."company_id" = "companies"."id" and m."status" = 'activa'
      )`,
    })
    .from(companies)
    .where(isNull(companies.deletedAt))
    .orderBy(asc(companies.name));

export const getCompanyById = async (id: string) => {
  const [company] = await db
    .select()
    .from(companies)
    .where(and(eq(companies.id, id), isNull(companies.deletedAt)))
    .limit(1);

  return company ?? null;
};

export const createCompany = async (
  input: CompanyInput,
  actorUserId: string,
) => {
  const values = normalizeInput(input);

  if (await getCompanyBySlug(values.slug)) {
    throw new CompanyError("Ya existe una empresa con ese identificador.");
  }

  const [company] = await db.insert(companies).values(values).returning();

  await auditCompany(
    company,
    actorUserId,
    "create",
    `Empresa creada: ${company.name}`,
    values,
  );

  return company;
};

export const updateCompany = async (
  id: string,
  input: CompanyInput,
  actorUserId: string,
) => {
  const values = normalizeInput(input);
  const existing = await getCompanyById(id);

  if (!existing) {
    throw new CompanyError("No encontramos esa empresa.");
  }

  const sameSlug = await getCompanyBySlug(values.slug);

  if (sameSlug && sameSlug.id !== id) {
    throw new CompanyError("Ya existe una empresa con ese identificador.");
  }

  const [company] = await db
    .update(companies)
    .set(values)
    .where(eq(companies.id, id))
    .returning();

  await auditCompany(
    company,
    actorUserId,
    "update",
    `Empresa editada: ${company.name}`,
    values,
  );

  return company;
};

/** A suspended company keeps its data, but nobody can act in it until it is reactivated. */
export const setCompanyStatus = async (
  id: string,
  status: CompanyStatus,
  actorUserId: string,
) => {
  const existing = await getCompanyById(id);

  if (!existing) {
    throw new CompanyError("No encontramos esa empresa.");
  }

  const [company] = await db
    .update(companies)
    .set({ status })
    .where(eq(companies.id, id))
    .returning();

  await auditCompany(
    company,
    actorUserId,
    status === "activa" ? "activate" : "deactivate",
    status === "activa"
      ? `Empresa reactivada: ${company.name}`
      : `Empresa suspendida: ${company.name}`,
    { status },
  );

  return company;
};
