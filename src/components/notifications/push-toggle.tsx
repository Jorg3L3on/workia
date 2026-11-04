"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";

type State =
  "loading" | "unsupported" | "denied" | "off" | "on" | "working" | "error";

const toKey = (base64url: string) => {
  const padded = (base64url + "=".repeat((4 - (base64url.length % 4)) % 4))
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const raw = window.atob(padded);
  const bytes = new Uint8Array(raw.length);

  for (let index = 0; index < raw.length; index += 1) {
    bytes[index] = raw.charCodeAt(index);
  }

  return bytes;
};

const supported = () =>
  typeof window !== "undefined" &&
  "serviceWorker" in navigator &&
  "PushManager" in window &&
  "Notification" in window;

const registration = () =>
  navigator.serviceWorker
    .getRegistration("/mi/")
    .then(
      (found) =>
        found ??
        navigator.serviceWorker.register("/mi/sw.js", { scope: "/mi/" }),
    );

/**
 * «Avisos en este teléfono» (W2-08): subscribes this browser to web push
 * with the server's VAPID key and saves it for the signed-in person, or
 * removes it. On iPhone, push works once the app is on the home screen.
 */
export const PushToggle = ({ publicKey }: { publicKey: string }) => {
  const [state, setState] = useState<State>("loading");

  useEffect(() => {
    let cancelled = false;

    const check = async () => {
      if (!supported()) {
        return "unsupported" as const;
      }

      if (Notification.permission === "denied") {
        return "denied" as const;
      }

      const current = await (
        await registration()
      ).pushManager.getSubscription();

      return current ? ("on" as const) : ("off" as const);
    };

    check()
      .catch(() => "unsupported" as const)
      .then((next) => {
        if (!cancelled) {
          setState(next);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const turnOn = async () => {
    setState("working");

    try {
      const permission = await Notification.requestPermission();

      if (permission !== "granted") {
        setState(permission === "denied" ? "denied" : "off");
        return;
      }

      const sw = await registration();
      const subscription =
        (await sw.pushManager.getSubscription()) ??
        (await sw.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: toKey(publicKey),
        }));
      const response = await fetch("/api/mi/push", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(subscription.toJSON()),
      });

      setState(response.ok ? "on" : "error");
    } catch {
      setState("error");
    }
  };

  const turnOff = async () => {
    setState("working");

    try {
      const subscription = await (
        await registration()
      ).pushManager.getSubscription();

      if (subscription) {
        await fetch("/api/mi/push", {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        });
        await subscription.unsubscribe();
      }

      setState("off");
    } catch {
      setState("error");
    }
  };

  const status: Record<State, string> = {
    loading: "Revisando…",
    unsupported:
      "Este navegador no recibe avisos. En iPhone, primero agrega Workia a tu pantalla de inicio.",
    denied:
      "Bloqueaste los avisos de Workia. Actívalos en los ajustes del navegador.",
    off: "Desactivados en este teléfono.",
    on: "Activados en este teléfono.",
    working: "Un momento…",
    error: "No se pudo cambiar. Intenta de nuevo.",
  };
  const on = state === "on";
  const canToggle = state === "on" || state === "off" || state === "error";

  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div className="min-w-0">
        <p className="text-sm font-medium">Avisos en este teléfono</p>
        <p aria-live="polite" className="text-muted-foreground text-sm">
          {status[state]}
        </p>
      </div>
      {canToggle ? (
        <Button
          onClick={on ? turnOff : turnOn}
          size="sm"
          type="button"
          variant="secondary"
        >
          {on ? "Desactivar" : "Activar"}
        </Button>
      ) : null}
    </div>
  );
};
