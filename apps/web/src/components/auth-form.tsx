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
  const errorId = `${mode}-error`;
  const statusId = `${mode}-status`;

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
    <form
      action={onSubmit}
      aria-busy={isPending}
      aria-describedby={statusId}
      className="mt-8"
    >
      <FieldGroup className="gap-6">
        <Field>
          <FieldLabel htmlFor="username">
            {isSignUp ? "Username" : "Username or email"}
          </FieldLabel>
          <Input
            id="username"
            name="username"
            autoComplete="username"
            aria-describedby={error ? errorId : undefined}
            aria-invalid={error !== null}
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
              name="email"
              type="email"
              autoComplete="email"
              aria-describedby={error ? errorId : undefined}
              aria-invalid={error !== null}
              placeholder="you@office-ladder.club"
              required
            />
          </Field>
        ) : null}

        <Field>
          <FieldLabel htmlFor="password">Password</FieldLabel>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete={isSignUp ? "new-password" : "current-password"}
            aria-describedby={error ? errorId : undefined}
            aria-invalid={error !== null}
            minLength={8}
            placeholder={isSignUp ? "8 characters minimum" : "Enter your password"}
            required
          />
        </Field>

        {error ? (
          <Alert id={errorId} variant="destructive" className="border-destructive/30 bg-destructive/10">
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
        <p id={statusId} role="status" aria-live="polite" className="sr-only">
          {isPending
            ? isSignUp
              ? "Creating account"
              : "Signing in"
            : ""}
        </p>
      </FieldGroup>
    </form>
  );
}
