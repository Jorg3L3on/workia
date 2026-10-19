import { PersonAssetsTable } from "@/components/resguardo/assets-data-table";
import type { PersonAssetItem } from "@/lib/resguardo";

type PersonAssetsSectionProps = {
  assets: PersonAssetItem[];
  canReadAssets: boolean;
};

export const PersonAssetsSection = ({
  assets,
  canReadAssets,
}: PersonAssetsSectionProps) => {
  if (!canReadAssets) {
    return null;
  }

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-base font-semibold">Equipo en resguardo</h2>
        <p className="text-muted-foreground text-sm">
          Activos asignados actualmente a esta persona.
        </p>
      </div>

      <PersonAssetsTable assets={assets} />
    </section>
  );
};
