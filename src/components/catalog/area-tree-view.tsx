import type { AreaTreeNode } from "@/lib/catalog/schema";
import { CatalogRowDeleteButton } from "@/components/catalog/catalog-row-delete-button";
import { ListEmptyState } from "@/components/list/list-table-shell";
import { Badge } from "@/components/ui/badge";
import { deleteAreaAction } from "@/lib/catalog/actions";
import { FolderIcon, FolderOpenIcon } from "lucide-react";
import { activeTone, deletedTone } from "@/lib/ui/status-tone";

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
    <li>
      <div
        className="flex flex-wrap items-center justify-between gap-2 py-2 pr-3"
        style={{ paddingLeft: 12 + depth * 20 }}
      >
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Icon aria-hidden className="text-muted-foreground size-4 shrink-0" />
          <span
            className={`text-sm font-medium ${isDeleted ? "text-muted-foreground line-through" : ""}`}
          >
            {node.name}
          </span>
          {!node.active ? (
            <Badge tone={activeTone(false)}>Inactiva</Badge>
          ) : null}
          {isDeleted ? <Badge tone={deletedTone}>Borrada</Badge> : null}
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
        <ul className="divide-y border-t">
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
    <ul className="workia-pass-card divide-y">
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
