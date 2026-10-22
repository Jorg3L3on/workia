import { PersonAssetsTable } from "@/components/resguardo/assets-data-table";
import type { PersonAssetItem } from "@/lib/resguardo";

type PersonAssetsSectionProps = {
  assets: PersonAssetItem[];
  canReadAssets: boolean;
  /** Inside the expediente's Resguardo card, which carries the heading. */
  showHeading?: boolean;
};

export const PersonAssetsSection = ({
  assets,
  canReadAssets,
  showHeading = true,
}: PersonAssetsSectionProps) => {
  if (!canReadAssets) {
    return null;
  }

  return (
    <section className="space-y-3">
      {showHeading ? (
        <div>
          <h2 className="text-base font-semibold">Equipo en resguardo</h2>
          <p className="text-muted-foreground text-sm">
            Activos asignados actualmente a esta persona.
          </p>
        </div>
      ) : null}

      <PersonAssetsTable assets={assets} />
    </section>
  );
};
