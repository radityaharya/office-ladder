import { useState, useTransition } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { signIn, signUp } from "@/lib/auth-client";

type AuthFormProps = {
  mode: "sign-in" | "sign-up";
};

export function AuthForm({ mode }: AuthFormProps) {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const isSignUp = mode === "sign-up";

  function onSubmit(formData: FormData) {
    setError(null);

    startTransition(async () => {
      const username = String(formData.get("username") || "").trim();
      const email = String(formData.get("email") || "").trim();
      const password = String(formData.get("password") || "");

      const result =
        isSignUp
          ? await signUp.email({
              name: username,
              username,
              email,
              password,
            })
          : username.includes("@")
            ? await signIn.email({ email: username, password })
            : await signIn.username({ username, password });

      if (result.error) {
        setError(result.error.message || "Authentication failed");
        return;
      }

      await navigate({ to: "/" });
    });
  }

  return (
    <form action={onSubmit} className="mt-8">
      <FieldGroup className="gap-6">
        <Field>
          <FieldLabel htmlFor="username">
            {isSignUp ? "Username" : "Username or email"}
          </FieldLabel>
          <Input
            id="username"
            className="border border-input bg-background px-4 py-3 font-mono text-sm text-foreground placeholder:text-muted-foreground focus-visible:border-primary"
            name="username"
            autoComplete="username"
            minLength={3}
            maxLength={30}
            placeholder={isSignUp ? "intern-of-chaos" : "intern-of-chaos or email@company.com"}
            required
          />
        </Field>

        {isSignUp ? (
          <Field>
            <FieldLabel htmlFor="email">Email</FieldLabel>
            <Input
              id="email"
              className="border border-input bg-background px-4 py-3 font-mono text-sm text-foreground placeholder:text-muted-foreground focus-visible:border-primary"
              name="email"
              type="email"
              autoComplete="email"
              placeholder="you@office-ladder.club"
              required
            />
          </Field>
        ) : null}

        <Field>
          <FieldLabel htmlFor="password">Password</FieldLabel>
          <Input
            id="password"
            className="border border-input bg-background px-4 py-3 font-mono text-sm text-foreground placeholder:text-muted-foreground focus-visible:border-primary"
            name="password"
            type="password"
            autoComplete={isSignUp ? "new-password" : "current-password"}
            minLength={8}
            placeholder={isSignUp ? "8 characters minimum" : "Enter your password"}
            required
          />
        </Field>

        {error ? (
          <Alert variant="destructive" className="border-destructive/30 bg-destructive/10">
            <AlertTitle>Access denied</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <Button className="w-full" disabled={isPending} size="lg" type="submit">
          {isPending
            ? isSignUp
              ? "Creating account..."
              : "Signing in..."
            : isSignUp
              ? "Claim your desk"
              : "Get back in the room"}
        </Button>
      </FieldGroup>
    </form>
  );
}
