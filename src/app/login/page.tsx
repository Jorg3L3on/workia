import { LoginForm } from "@/components/auth/login-form";
import { LoginStage } from "@/components/auth/login-stage";

export default function LoginPage() {
  return (
    <LoginStage>
      <LoginForm />
    </LoginStage>
  );
}
