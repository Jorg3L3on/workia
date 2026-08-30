import { AssetForm } from "@/components/resguardo/asset-form";
import { requireAssetsCreate } from "@/lib/resguardo/auth";

export const dynamic = "force-dynamic";

const NuevoActivoPage = async () => {
  await requireAssetsCreate();

  return (
    <div className="mx-auto w-full max-w-3xl">
      <AssetForm />
    </div>
  );
};

export default NuevoActivoPage;
