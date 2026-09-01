import Link from "next/link";

import { ListEmptyState } from "@/components/list/list-table-shell";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { PersonAssetItem } from "@/lib/resguardo";
import { assetCategoryLabels } from "@/lib/resguardo/schema";

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
    <div className="workia-pass-card overflow-hidden">
      <div className="border-b px-5 py-4">
        <h2 className="text-base font-semibold">Equipo en resguardo</h2>
        <p className="text-muted-foreground text-sm">
          Activos asignados actualmente a esta persona.
        </p>
      </div>

      {assets.length === 0 ? (
        <ListEmptyState
          className="py-8"
          description="Cuando tenga activos en custodia, aparecerán aquí."
          title="Sin equipo asignado"
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Activo</TableHead>
              <TableHead>Categoría</TableHead>
              <TableHead>Condición</TableHead>
              <TableHead className="text-right">Detalle</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {assets.map((asset) => (
              <TableRow key={asset.id}>
                <TableCell>
                  <div>
                    <p className="font-medium">{asset.name}</p>
                    <p className="text-muted-foreground text-xs">
                      {asset.identifier}
                    </p>
                  </div>
                </TableCell>
                <TableCell>
                  {assetCategoryLabels[asset.category] ?? asset.category}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {asset.conditionNote ?? "—"}
                </TableCell>
                <TableCell className="text-right">
                  <Link
                    className="text-primary text-sm font-medium hover:underline"
                    href={`/app/resguardo/${asset.id}`}
                  >
                    Ver activo
                  </Link>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
};
