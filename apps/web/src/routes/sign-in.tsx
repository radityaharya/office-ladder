import { createFileRoute } from "@tanstack/react-router";

import { AuthScreen } from "@/components/auth-form";

export const Route = createFileRoute("/sign-in")({
  component: SignInPage,
});

function SignInPage() {
  return <AuthScreen mode="sign-in" />;
}
