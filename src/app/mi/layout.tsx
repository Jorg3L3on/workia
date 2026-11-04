import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import { EmployeeServiceWorker } from "@/components/employee/service-worker";

// The employee app (W2-01): its own manifest, so it installs to a phone's
// home screen opening on /mi, apart from the HR app.
export const metadata: Metadata = {
  title: {
    default: "Mi Workia",
    template: "%s — Mi Workia",
  },
  manifest: "/mi/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Mi Workia",
    statusBarStyle: "default",
  },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#0b7fa6",
  width: "device-width",
  initialScale: 1,
};

export default function EmployeeLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <EmployeeServiceWorker />
      {children}
    </>
  );
}
