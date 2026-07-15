import Link from "next/link";

export default function Home() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-950 px-6 py-16 text-white">
      <section className="w-full max-w-3xl rounded-[2rem] border border-white/10 bg-white/[0.04] p-8 shadow-2xl shadow-black/40 backdrop-blur md:p-12">
        <p className="text-sm font-medium uppercase tracking-[0.35em] text-cyan-300">
          Office Ladder
        </p>
        <h1 className="mt-5 max-w-2xl text-4xl font-semibold tracking-tight md:text-6xl">
          Basic Better Auth username scaffold is ready.
        </h1>
        <p className="mt-6 max-w-xl text-base leading-7 text-zinc-300 md:text-lg">
          Create an account with username, email, and password, then sign in
          with either username or email using the Better Auth API route.
        </p>
        <div className="mt-10 flex flex-col gap-3 sm:flex-row">
          <Link
            className="rounded-full bg-cyan-300 px-6 py-3 text-center text-sm font-semibold text-zinc-950 transition hover:bg-cyan-200"
            href="/sign-up"
          >
            Create account
          </Link>
          <Link
            className="rounded-full border border-white/15 px-6 py-3 text-center text-sm font-semibold text-white transition hover:bg-white/10"
            href="/sign-in"
          >
            Sign in
          </Link>
        </div>
      </section>
      </main>
  );
}
