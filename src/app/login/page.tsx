import type { Metadata } from "next";

import { LoginForm } from "@/components/auth/login-form";
import { LoginStage } from "@/components/auth/login-stage";
import { pageTitles } from "@/lib/brand/chrome-copy";

export const metadata: Metadata = {
  title: pageTitles.login,
};

export default function LoginPage() {
  return (
    <LoginStage>
      <LoginForm />
    </LoginStage>
  );
}
