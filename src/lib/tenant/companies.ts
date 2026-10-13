import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { companies } from "@/lib/db/schema";

/** The company migration 0015 creates; every pre-multi-company row belongs to it. */
export const DEFAULT_COMPANY = {
  name: "Ferretera Mandiola",
  slug: "ferretera-mandiola",
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

/** For scripts: `--company <slug>` (default company otherwise) → its id. */
export const companyIdFromArgs = async (argv: string[] = process.argv) => {
  const index = argv.indexOf("--company");
  const slug = index >= 0 ? argv[index + 1] : DEFAULT_COMPANY.slug;
  const company = await getCompanyBySlug(slug);

  if (!company) {
    throw new Error(`No company with slug "${slug}"`);
  }

  return company.id;
};
