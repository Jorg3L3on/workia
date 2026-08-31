import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { pageTitles } from "@/lib/brand/chrome-copy";
import { CATALOG_PATHS } from "@/lib/catalog/paths";

export const metadata: Metadata = {
  title: pageTitles.catalogo,
};

export const dynamic = "force-dynamic";

const CatalogoIndexPage = () => {
  redirect(CATALOG_PATHS.areas);
};

export default CatalogoIndexPage;
