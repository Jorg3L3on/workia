import { Tag } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { permissionLabel } from "@/lib/rbac/labels";

/** A permission in words; the slug is in the tooltip. */
export const PermissionTag = ({ slug }: { slug: string }) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <Tag tabIndex={0}>{permissionLabel(slug)}</Tag>
    </TooltipTrigger>
    <TooltipContent className="font-mono">{slug}</TooltipContent>
  </Tooltip>
);
