import { Badge } from "@/components/ui/badge";
import type { TimeOffStatus } from "@/lib/db/schema/requests";
import { TIME_OFF_STATUS_LABELS } from "@/lib/requests/rules";

const TONES = {
  pending: "warning",
  approved: "success",
  rejected: "danger",
  cancelled: "neutral",
} as const satisfies Record<TimeOffStatus, string>;

export const RequestStatusBadge = ({ status }: { status: TimeOffStatus }) => (
  <Badge tone={TONES[status]}>{TIME_OFF_STATUS_LABELS[status]}</Badge>
);
