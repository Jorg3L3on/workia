"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { checkInAction } from "@/lib/attendance/employee-actions";

type EmployeeCheckinProps = {
  siteName: string;
  code: { siteId: string; window: string; mac: string };
};

type Status =
  | { state: "idle" }
  | { state: "locating" | "sending"; kind: "in" | "out" }
  | { state: "done"; message: string }
  | { state: "error"; message: string };

const LOCATION_ERRORS: Record<number, string> = {
  1: "Permite el acceso a tu ubicación para checar; solo se usa para confirmar que estás en la sucursal.",
  2: "No pudimos leer tu ubicación. Activa la ubicación y vuelve a intentarlo.",
  3: "Tu ubicación tardó demasiado. Vuelve a intentarlo.",
};

const position = () =>
  new Promise<GeolocationPosition>((resolve, reject) => {
    if (!("geolocation" in navigator)) {
      reject({ code: 2 });
      return;
    }

    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 15_000,
      maximumAge: 0,
    });
  });

/** Entrada and salida buttons; the location is read only when one is pressed. */
export const EmployeeCheckin = ({ siteName, code }: EmployeeCheckinProps) => {
  const [status, setStatus] = useState<Status>({ state: "idle" });
  const busy = status.state === "locating" || status.state === "sending";

  const punch = async (kind: "in" | "out") => {
    setStatus({ state: "locating", kind });

    let fix: GeolocationPosition;

    try {
      fix = await position();
    } catch (error) {
      const codeNumber = (error as { code?: number }).code ?? 2;

      setStatus({
        state: "error",
        message: LOCATION_ERRORS[codeNumber] ?? LOCATION_ERRORS[2],
      });
      return;
    }

    setStatus({ state: "sending", kind });

    try {
      const result = await checkInAction({
        ...code,
        kind,
        latitude: fix.coords.latitude,
        longitude: fix.coords.longitude,
        accuracy: fix.coords.accuracy,
      });

      setStatus(
        result.ok
          ? { state: "done", message: result.message }
          : { state: "error", message: result.error },
      );
    } catch {
      setStatus({
        state: "error",
        message: "No pudimos registrar la checada. Vuelve a intentarlo.",
      });
    }
  };

  return (
    <section
      aria-labelledby="checar-title"
      className="workia-pass-card flex flex-col gap-4 px-5 py-5"
    >
      <div className="space-y-1">
        <p className="text-muted-foreground text-sm">Checar en</p>
        <h1 className="text-2xl font-semibold tracking-tight" id="checar-title">
          {siteName}
        </h1>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Button
          aria-busy={busy}
          className="h-16 text-base"
          disabled={busy}
          onClick={() => punch("in")}
          size="lg"
          type="button"
        >
          {busy && status.kind === "in" ? "Registrando…" : "Entrada"}
        </Button>
        <Button
          aria-busy={busy}
          className="h-16 text-base"
          disabled={busy}
          onClick={() => punch("out")}
          size="lg"
          type="button"
          variant="secondary"
        >
          {busy && status.kind === "out" ? "Registrando…" : "Salida"}
        </Button>
      </div>

      <div aria-live="polite" className="min-h-6 text-sm">
        {status.state === "locating" ? (
          <p className="text-muted-foreground">Leyendo tu ubicación…</p>
        ) : null}
        {status.state === "done" ? (
          <p className="font-medium">{status.message}</p>
        ) : null}
        {status.state === "error" ? (
          <p className="text-destructive" role="alert">
            {status.message}
          </p>
        ) : null}
      </div>

      <p className="text-muted-foreground text-xs">
        Tu ubicación solo se usa en este momento para confirmar que estás en la
        sucursal; no se guarda.
      </p>
    </section>
  );
};
