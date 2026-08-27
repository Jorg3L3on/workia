import { z } from "zod";

export const areaFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "El nombre es obligatorio")
    .max(120, "Máximo 120 caracteres"),
  parentAreaId: z
    .string()
    .uuid("Área padre inválida")
    .optional()
    .or(z.literal("")),
  active: z.boolean(),
});

export type AreaFormValues = z.infer<typeof areaFormSchema>;

export const positionFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "El nombre es obligatorio")
    .max(120, "Máximo 120 caracteres"),
  areaId: z.string().uuid("Área inválida").optional().or(z.literal("")),
  active: z.boolean(),
});

export type PositionFormValues = z.infer<typeof positionFormSchema>;

export type AreaTreeNode = {
  id: string;
  name: string;
  active: boolean;
  deletedAt: Date | null;
  parentAreaId: string | null;
  children: AreaTreeNode[];
};

export const buildAreaTree = (
  areas: Array<{
    id: string;
    name: string;
    active: boolean;
    deletedAt: Date | null;
    parentAreaId: string | null;
  }>,
): AreaTreeNode[] => {
  const nodes = new Map<string, AreaTreeNode>();

  for (const area of areas) {
    nodes.set(area.id, { ...area, children: [] });
  }

  const roots: AreaTreeNode[] = [];

  for (const node of nodes.values()) {
    if (node.parentAreaId && nodes.has(node.parentAreaId)) {
      nodes.get(node.parentAreaId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  const sortNodes = (items: AreaTreeNode[]) => {
    items.sort((a, b) => a.name.localeCompare(b.name, "es"));
    for (const item of items) {
      sortNodes(item.children);
    }
  };

  sortNodes(roots);
  return roots;
};
