import type { AreaTreeNode } from "@/lib/catalog/schema";
import { CatalogRowDeleteButton } from "@/components/catalog/catalog-row-delete-button";
import { ListEmptyState } from "@/components/list/list-table-shell";
import { ListStatusBadge } from "@/components/list/list-status-badge";
import { deleteAreaAction } from "@/lib/catalog/actions";
import { FolderIcon, FolderOpenIcon } from "lucide-react";

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
  const hasChildren = node.children.length > 0;
  const Icon = hasChildren ? FolderOpenIcon : FolderIcon;

  return (
    <li className="space-y-2">
      <div
        className="bg-card flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-2"
        style={{ marginLeft: depth * 16 }}
      >
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Icon aria-hidden className="text-muted-foreground size-4 shrink-0" />
          <span
            className={`text-sm font-medium ${isDeleted ? "text-muted-foreground line-through" : ""}`}
          >
            {node.name}
          </span>
          {!node.active ? (
            <ListStatusBadge tone="inactive">Inactiva</ListStatusBadge>
          ) : null}
          {isDeleted ? (
            <ListStatusBadge tone="destructive">Borrada</ListStatusBadge>
          ) : null}
        </div>
        {canDelete && !isDeleted ? (
          <CatalogRowDeleteButton
            action={deleteAreaAction.bind(null, node.id)}
            itemLabel="área"
            itemName={node.name}
          />
        ) : null}
      </div>
      {hasChildren ? (
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
      <ListEmptyState
        className="py-8"
        description="Crea la primera área para armar el árbol."
        title="Aún no hay áreas en el catálogo"
      />
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
