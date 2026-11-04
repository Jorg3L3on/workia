import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { EmployeeBadge } from "@/components/employee/employee-badge";
import { EmployeeSignIn } from "@/components/employee/employee-sign-in";
import { LoginStage } from "@/components/auth/login-stage";
import { env } from "@/env";
import { getEmployeeContext } from "@/lib/employee-accounts/session";
import { SIGN_IN_COPY } from "@/lib/employee-accounts/sign-in";

export const metadata: Metadata = { title: "Entrar" };

type EmployeeSignInPageProps = {
  searchParams: Promise<{ correo?: string; codigo?: string; error?: string }>;
};

const errors: Record<string, string> = {
  google: "No pudimos entrar con Google. Inténtalo de nuevo.",
  "google-cuenta": SIGN_IN_COPY.googleNoAccount,
};

const EmployeeSignInPage = async ({
  searchParams,
}: EmployeeSignInPageProps) => {
  if (await getEmployeeContext()) {
    redirect("/mi");
  }

  const params = await searchParams;

  return (
    <LoginStage>
      <EmployeeBadge
        description="Consulta tu información de empleado. Tu empresa te dio acceso."
        title="Entra a Mi Workia"
      >
        <EmployeeSignIn
          defaultCode={params.codigo?.slice(0, 7)}
          defaultEmail={params.correo?.slice(0, 254)}
          error={params.error ? (errors[params.error] ?? null) : null}
          googleEnabled={Boolean(env.AUTH_GOOGLE_ID && env.AUTH_GOOGLE_SECRET)}
        />
      </EmployeeBadge>
    </LoginStage>
  );
};

export default EmployeeSignInPage;
