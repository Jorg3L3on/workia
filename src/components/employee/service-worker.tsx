"use client";

import { useEffect } from "react";

/** Registers /mi/sw.js so phones can install the employee app (W2-01). */
export const EmployeeServiceWorker = () => {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker
        .register("/mi/sw.js", { scope: "/mi/" })
        .catch(() => undefined);
    }
  }, []);

  return null;
};
