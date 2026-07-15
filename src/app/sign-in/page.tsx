import Link from "next/link";
import { AuthForm } from "@/components/auth-form";

export default function SignInPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-950 px-6 py-16 text-white">
      <section className="w-full max-w-md rounded-3xl border border-white/10 bg-white/[0.04] p-8 shadow-2xl shadow-black/40">
        <p className="text-sm font-medium uppercase tracking-[0.3em] text-cyan-300">
          Welcome back
        </p>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight">Sign in</h1>
        <p className="mt-3 text-sm leading-6 text-zinc-300">
          Use your username or email and password.
        </p>
        <AuthForm mode="sign-in" />
        <p className="mt-6 text-center text-sm text-zinc-400">
          Need an account?{" "}
          <Link className="font-medium text-cyan-300 hover:text-cyan-200" href="/sign-up">
            Sign up
          </Link>
        </p>
      </section>
    </main>
  );
}
