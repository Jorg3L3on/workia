import type { AreaTreeNode } from "@/lib/catalog/schema";
import { CatalogRowDeleteButton } from "@/components/catalog/catalog-row-delete-button";
import { Badge } from "@/components/ui/badge";
import { deleteAreaAction } from "@/lib/catalog/actions";

type AreaTreeViewProps = {
  nodes: AreaTreeNode[];
  depth?: number;
  canDelete?: boolean;
};

const AreaTreeItem = ({
  node,
  depth = 0,
  canDelete = false,
}: {
  node: AreaTreeNode;
  depth?: number;
  canDelete?: boolean;
}) => {
  const isDeleted = Boolean(node.deletedAt);

  return (
    <li className="space-y-2">
      <div
        className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2"
        style={{ marginLeft: depth * 16 }}
      >
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`text-sm font-medium ${isDeleted ? "text-muted-foreground line-through" : ""}`}
          >
            {node.name}
          </span>
          {!node.active ? <Badge variant="secondary">Inactiva</Badge> : null}
          {isDeleted ? <Badge variant="outline">Borrada</Badge> : null}
        </div>
        {canDelete && !isDeleted ? (
          <CatalogRowDeleteButton
            action={deleteAreaAction.bind(null, node.id)}
            itemLabel="área"
            itemName={node.name}
          />
        ) : null}
      </div>
      {node.children.length > 0 ? (
        <ul className="space-y-2">
          {node.children.map((child) => (
            <AreaTreeItem
              canDelete={canDelete}
              depth={depth + 1}
              key={child.id}
              node={child}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
};

export const AreaTreeView = ({
  nodes,
  depth = 0,
  canDelete = false,
}: AreaTreeViewProps) => {
  if (nodes.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        Aún no hay áreas en el catálogo.
      </p>
    );
  }

  return (
    <ul className="space-y-2">
      {nodes.map((node) => (
        <AreaTreeItem
          canDelete={canDelete}
          depth={depth}
          key={node.id}
          node={node}
        />
      ))}
    </ul>
  );
};
