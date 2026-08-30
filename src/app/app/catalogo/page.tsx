import { redirect } from "next/navigation";

import { CATALOG_PATHS } from "@/lib/catalog/paths";

export const dynamic = "force-dynamic";

const CatalogoIndexPage = () => {
  redirect(CATALOG_PATHS.areas);
};

export default CatalogoIndexPage;
