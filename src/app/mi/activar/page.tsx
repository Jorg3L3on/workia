import type { Metadata } from "next";

import { EmployeeActivate } from "@/components/employee/employee-activate";
import { EmployeeBadge } from "@/components/employee/employee-badge";
import { LoginStage } from "@/components/auth/login-stage";

export const metadata: Metadata = { title: "Activar cuenta" };

export default function EmployeeActivatePage() {
  return (
    <LoginStage>
      <EmployeeBadge
        description="Escribe tu CURP y el código que te dio RH, y elige una contraseña."
        title="Activa tu cuenta"
      >
        <EmployeeActivate />
      </EmployeeBadge>
    </LoginStage>
  );
}
