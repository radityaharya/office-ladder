import { createFileRoute } from "@tanstack/react-router";

import { AuthScreen } from "@/components/auth-form";

export const Route = createFileRoute("/sign-up")({
  component: SignUpPage,
});

function SignUpPage() {
  return <AuthScreen mode="sign-up" />;
}
