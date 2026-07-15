"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { signIn, signUp } from "@/lib/auth-client";

type AuthFormProps = {
  mode: "sign-in" | "sign-up";
};

export function AuthForm({ mode }: AuthFormProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function onSubmit(formData: FormData) {
    setError(null);

    startTransition(async () => {
      const username = String(formData.get("username") || "").trim();
      const email = String(formData.get("email") || "").trim();
      const password = String(formData.get("password") || "");

      const result =
        mode === "sign-up"
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

      router.push("/");
      router.refresh();
    });
  }

  return (
    <form action={onSubmit} className="mt-8 space-y-4">
      <label className="block text-sm font-medium text-zinc-200">
        {mode === "sign-up" ? "Username" : "Username or email"}
        <input
          className="mt-2 w-full rounded-2xl border border-white/10 bg-zinc-900 px-4 py-3 text-white outline-none transition placeholder:text-zinc-500 focus:border-cyan-300"
          name="username"
          autoComplete="username"
          minLength={3}
          maxLength={30}
          required
        />
      </label>

      {mode === "sign-up" ? (
        <label className="block text-sm font-medium text-zinc-200">
          Email
          <input
            className="mt-2 w-full rounded-2xl border border-white/10 bg-zinc-900 px-4 py-3 text-white outline-none transition placeholder:text-zinc-500 focus:border-cyan-300"
            name="email"
            type="email"
            autoComplete="email"
            required
          />
        </label>
      ) : null}

      <label className="block text-sm font-medium text-zinc-200">
        Password
        <input
          className="mt-2 w-full rounded-2xl border border-white/10 bg-zinc-900 px-4 py-3 text-white outline-none transition placeholder:text-zinc-500 focus:border-cyan-300"
          name="password"
          type="password"
          autoComplete={mode === "sign-up" ? "new-password" : "current-password"}
          minLength={8}
          required
        />
      </label>

      {error ? (
        <p className="rounded-2xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </p>
      ) : null}

      <button
        className="w-full rounded-2xl bg-cyan-300 px-5 py-3 text-sm font-semibold text-zinc-950 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-60"
        disabled={isPending}
        type="submit"
      >
        {isPending
          ? "Working..."
          : mode === "sign-up"
            ? "Create account"
            : "Sign in"}
      </button>
    </form>
  );
}
