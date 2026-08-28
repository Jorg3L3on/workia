import type { Metadata } from "next";

import { LandingPage } from "@/components/landing/landing-page";

export const metadata: Metadata = {
  title: "workia — RRHH sin cazar fechas en Excel",
  description:
    "El expediente vive en Workia. Los contratos que vencen se ven a tiempo. El equipo caro tiene dueño e historial.",
};

export default function Home() {
  return <LandingPage />;
}
