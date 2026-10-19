"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { getUndoPreview, runUndo, type UndoPreview } from "./import-api";

type Props = {
  jobId: string;
  fileName: string;
  /** Opened from the row menu of the import history. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/** Asks the server whether the import can be undone, shows blockers, then undoes it. */
export const ImportUndoDialog = ({
  jobId,
  fileName,
  open,
  onOpenChange: setOpen,
}: Props) => {
  const router = useRouter();
  const [preview, setPreview] = useState<UndoPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;

    // The history mounts the dialog per job, so state starts fresh.
    let cancelled = false;
    getUndoPreview(jobId)
      .then((next) => {
        if (!cancelled) setPreview(next);
      })
      .catch((cause: Error) => {
        if (!cancelled) setError(cause.message);
      });

    return () => {
      cancelled = true;
    };
  }, [jobId, open]);

  const onOpenChange = (next: boolean) => {
    if (!busy) setOpen(next);
  };

  const undo = async () => {
    setBusy(true);
    setError(null);

    try {
      await runUndo(jobId, (step) =>
        setProgress(`${step.undone.toLocaleString("es-MX")} filas revertidas…`),
      );
      setOpen(false);
      router.refresh();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Deshacer importación</DialogTitle>
          <DialogDescription>
            {fileName}: se borrarán las personas y contratos que creó y se
            restaurarán los datos que actualizó.
          </DialogDescription>
        </DialogHeader>

        {!preview && !error ? (
          <p className="text-muted-foreground text-sm">Revisando…</p>
        ) : null}
        {error ? (
          <p className="text-destructive text-sm" role="alert">
            {error}
          </p>
        ) : null}
        {preview && !preview.allowed ? (
          <div className="flex flex-col gap-2 text-sm">
            <p role="alert">{preview.reason}</p>
            {preview.blockers.length > 0 ? (
              <ul className="max-h-48 list-disc overflow-y-auto pl-5">
                {preview.blockers.map((blocker) => (
                  <li key={`${blocker.type}-${blocker.id}-${blocker.reason}`}>
                    <span className="font-medium">{blocker.name}</span>:{" "}
                    {blocker.reason}
                  </li>
                ))}
              </ul>
            ) : null}
            {preview.blockerTotal > preview.blockers.length ? (
              <p className="text-muted-foreground">
                y{" "}
                {(
                  preview.blockerTotal - preview.blockers.length
                ).toLocaleString("es-MX")}{" "}
                más.
              </p>
            ) : null}
          </div>
        ) : null}
        {preview?.allowed ? (
          <p className="text-sm">
            Se revertirán {preview.rows.toLocaleString("es-MX")} filas. Esta
            acción queda en la auditoría.
          </p>
        ) : null}
        <p aria-live="polite" className="text-muted-foreground text-sm">
          {progress}
        </p>

        <DialogFooter>
          <Button
            disabled={busy}
            onClick={() => onOpenChange(false)}
            type="button"
            variant="secondary"
          >
            Cancelar
          </Button>
          <Button
            disabled={!preview?.allowed || busy}
            onClick={() => void undo()}
            type="button"
            variant="destructive"
          >
            Deshacer importación
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
