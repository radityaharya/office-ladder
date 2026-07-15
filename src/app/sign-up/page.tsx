import Link from "next/link";
import { AuthForm } from "@/components/auth-form";

export default function SignUpPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-950 px-6 py-16 text-white">
      <section className="w-full max-w-md rounded-3xl border border-white/10 bg-white/[0.04] p-8 shadow-2xl shadow-black/40">
        <p className="text-sm font-medium uppercase tracking-[0.3em] text-cyan-300">
          Start climbing
        </p>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight">Create account</h1>
        <p className="mt-3 text-sm leading-6 text-zinc-300">
          Pick a username and set up your login credentials.
        </p>
        <AuthForm mode="sign-up" />
        <p className="mt-6 text-center text-sm text-zinc-400">
          Already have an account?{" "}
          <Link className="font-medium text-cyan-300 hover:text-cyan-200" href="/sign-in">
            Sign in
          </Link>
        </p>
      </section>
    </main>
  );
}
