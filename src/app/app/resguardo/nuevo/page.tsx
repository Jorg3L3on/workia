import type { Metadata } from "next";

import { AssetForm } from "@/components/resguardo/asset-form";
import { pageTitles } from "@/lib/brand/chrome-copy";
import { requireAssetsCreate } from "@/lib/resguardo/auth";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: pageTitles.nuevoActivo,
};

const NuevoActivoPage = async () => {
  await requireAssetsCreate();

  return (
    <div className="mx-auto w-full max-w-3xl">
      <AssetForm />
    </div>
  );
};

export default NuevoActivoPage;
