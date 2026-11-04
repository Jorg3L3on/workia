"use client";

import { DownloadIcon, XIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";

type InstallEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const DISMISSED_KEY = "workia.mi.install-dismissed";

const readDismissed = () => {
  try {
    return window.localStorage.getItem(DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
};

const isStandalone = () =>
  window.matchMedia("(display-mode: standalone)").matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true;

const isIos = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

/**
 * «Instala Workia» on /mi (W2-01): the browser's own install prompt where
 * there is one (Android, desktop Chrome), the Share → Add to Home Screen
 * steps on iPhone. Hidden once installed or dismissed.
 */
export const InstallPrompt = () => {
  const [installEvent, setInstallEvent] = useState<InstallEvent | null>(null);
  const [ios, setIos] = useState(false);
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    if (isStandalone() || readDismissed()) {
      return;
    }

    const onPrompt = (event: Event) => {
      event.preventDefault();
      setInstallEvent(event as InstallEvent);
      setHidden(false);
    };

    window.addEventListener("beforeinstallprompt", onPrompt);

    // Safari on iPhone has no prompt event: show the steps instead.
    const timer = window.setTimeout(() => {
      if (isIos()) {
        setIos(true);
        setHidden(false);
      }
    }, 0);

    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.clearTimeout(timer);
    };
  }, []);

  if (hidden) {
    return null;
  }

  const dismiss = () => {
    try {
      window.localStorage.setItem(DISMISSED_KEY, "1");
    } catch {
      // Private mode: it shows again next time.
    }
    setHidden(true);
  };

  return (
    <section
      aria-label="Instalar Workia"
      className="workia-pass-card flex items-start gap-3 px-5 py-4"
    >
      <div className="min-w-0 flex-1 space-y-1">
        <h2 className="text-base font-semibold">
          Instala Workia en tu teléfono
        </h2>
        <p className="text-muted-foreground text-sm">
          {ios
            ? "Toca Compartir y luego «Agregar a inicio» para abrir Workia como una app."
            : "Ábrela desde tu pantalla de inicio, sin buscar el enlace."}
        </p>
        {installEvent ? (
          <Button
            className="mt-2"
            onClick={async () => {
              await installEvent.prompt();
              await installEvent.userChoice;
              setInstallEvent(null);
              setHidden(true);
            }}
            size="lg"
          >
            <DownloadIcon /> Instalar
          </Button>
        ) : null}
      </div>
      <button
        aria-label="Ahora no"
        className="text-muted-foreground hover:text-foreground -m-1 rounded-md p-1"
        onClick={dismiss}
        type="button"
      >
        <XIcon className="size-4" />
      </button>
    </section>
  );
};
