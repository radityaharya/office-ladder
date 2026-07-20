import { createFileRoute, Link } from "@tanstack/react-router";

import { AuthForm } from "@/components/auth-form";
import { buttonVariants } from "@/components/ui/button";

export const Route = createFileRoute("/sign-up")({
  component: SignUpPage,
});

function SignUpPage() {
  return (
    <main className="min-h-screen bg-background px-5 py-6 text-foreground sm:px-8 lg:px-12">
      <div className="mx-auto flex min-h-[calc(100vh-3rem)] w-full max-w-7xl flex-col">
        <header className="flex items-center justify-between border-b border-border pb-5">
          <Link
            className="font-heading text-lg font-semibold tracking-[0.08em] uppercase"
            to="/"
          >
            Office Ladder
          </Link>
          <Link className={buttonVariants({ size: "sm", variant: "ghost" })} to="/sign-in">
            Sign in
          </Link>
        </header>

        <section className="grid flex-1 items-center gap-12 py-12 lg:grid-cols-[minmax(0,0.9fr)_minmax(24rem,0.55fr)]">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
              New hire paperwork
            </p>
            <h1 className="mt-5 font-heading text-5xl font-semibold tracking-[-0.035em] sm:text-7xl">
              Pick a name worth blaming.
            </h1>
            <p className="mt-6 max-w-lg text-base leading-8 text-muted-foreground">
              Your username is what the room sees while you climb from Intern to Director.
            </p>
          </div>

          <section
            className="border border-border bg-card p-6 sm:p-8"
            aria-labelledby="sign-up-title"
          >
            <h2 className="font-heading text-2xl font-semibold" id="sign-up-title">
              Create account
            </h2>
            <AuthForm mode="sign-up" />
            <p className="mt-7 border-t border-border pt-5 text-sm text-muted-foreground">
              Already on payroll?{" "}
              <Link
                className="text-foreground underline underline-offset-4 hover:text-primary"
                to="/sign-in"
              >
                Sign in
              </Link>
            </p>
          </section>
        </section>
      </div>
    </main>
  );
}
