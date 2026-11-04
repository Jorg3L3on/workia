import { Button } from "@/components/ui/button";

type ChannelFormProps = {
  action: (formData: FormData) => Promise<void>;
  channel: "email" | "push";
  enabled: boolean;
  label: string;
  description: string;
};

/** One channel on or off (W2-08). The in-app inbox has no switch: it always keeps the message. */
export const ChannelForm = ({
  action,
  channel,
  enabled,
  label,
  description,
}: ChannelFormProps) => (
  <form
    action={action}
    className="flex items-center justify-between gap-4 py-3"
  >
    <input name="channel" type="hidden" value={channel} />
    <input name="enabled" type="hidden" value={enabled ? "0" : "1"} />
    <div className="min-w-0">
      <p className="text-sm font-medium">
        {label}: {enabled ? "activado" : "desactivado"}
      </p>
      <p className="text-muted-foreground text-sm">{description}</p>
    </div>
    <Button size="sm" type="submit" variant="secondary">
      {enabled ? "Desactivar" : "Activar"}
    </Button>
  </form>
);
