"use client";

import Link from "next/link";
import { RoomEntryClient } from "@/components/room/room-entry-client";
import { Button, buttonVariants } from "@/components/ui/button";
import { signOut, useSession } from "@/lib/auth-client";
import { cn } from "@/lib/utils";

const steps = [
  ["Roll", "Move around the office."],
  ["Resolve", "Take the reward or survive the problem."],
  ["Promote", "Spend money and reputation to climb."],
];

export default function Home() {
  const { data: session, isPending } = useSession();
  const username = session?.user.username ?? session?.user.name;

  return (
    <main className="min-h-screen bg-background px-5 py-6 text-foreground sm:px-8 lg:px-12">
      <div className="mx-auto flex min-h-[calc(100vh-3rem)] w-full max-w-7xl flex-col">
        <header className="flex items-center justify-between border-b border-border pb-5">
          <Link className="font-heading text-lg font-semibold tracking-[0.08em] uppercase" href="/">
            Office Ladder
          </Link>
          {isPending ? (
            <span className="text-xs uppercase tracking-widest text-muted-foreground">Checking badge</span>
          ) : session ? (
            <div className="flex items-center gap-4">
              <span className="hidden text-sm text-muted-foreground sm:inline">
                Signed in as <span className="text-foreground">{username}</span>
              </span>
              <Button onClick={() => signOut()} size="sm" variant="ghost">
                Sign out
              </Button>
            </div>
          ) : (
            <Link className={buttonVariants({ size: "sm", variant: "outline" })} href="/sign-in">
              Sign in
            </Link>
          )}
        </header>

        {session ? (
          <section className="grid flex-1 items-center gap-12 py-14 lg:grid-cols-[minmax(0,0.9fr)_minmax(24rem,0.65fr)]">
            <div className="max-w-3xl">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Intern access granted</p>
              <h1 className="mt-5 font-heading text-4xl font-semibold tracking-[-0.03em] sm:text-6xl">
                Pick the next office fight.
              </h1>
              <p className="mt-6 max-w-xl text-base leading-8 text-muted-foreground">
                Create a private room for your group, or enter the code somebody dropped in the chat.
              </p>
            </div>

            <RoomEntryClient />
          </section>
        ) : (
          <>
            <section className="grid flex-1 items-center gap-14 py-14 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,0.55fr)] lg:py-20">
              <div className="max-w-4xl">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
                  3–6 players · private rooms · browser game
                </p>
                <h1 className="mt-6 font-heading text-5xl font-semibold tracking-[-0.035em] sm:text-7xl lg:text-8xl">
                  Survive the office. Steal the promotion.
                </h1>
                <p className="mt-7 max-w-2xl text-base leading-8 text-muted-foreground sm:text-lg">
                  Roll the dice, collect money and reputation, and reach Director before your coworkers do.
                </p>
                <div className="mt-9 flex flex-col gap-3 sm:flex-row">
                  <Link className={cn(buttonVariants({ size: "lg" }), "sm:min-w-48")} href="/sign-up">
                    Create account
                  </Link>
                  <Link
                    className={cn(buttonVariants({ size: "lg", variant: "outline" }), "sm:min-w-40")}
                    href="/sign-in"
                  >
                    Sign in
                  </Link>
                </div>
              </div>

              <div className="border-y border-border py-3">
                {steps.map(([title, body]) => (
                  <div className="grid grid-cols-[5rem_1fr] gap-5 border-b border-border py-6 last:border-b-0" key={title}>
                    <span className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">{title}</span>
                    <p className="text-sm leading-6 text-muted-foreground">{body}</p>
                  </div>
                ))}
              </div>
            </section>

            <footer className="flex flex-col gap-3 border-t border-border py-5 text-xs uppercase tracking-widest text-muted-foreground sm:flex-row sm:justify-between">
              <span>44 spaces · 30 second turns</span>
              <span>Intern to Director</span>
            </footer>
          </>
        )}
      </div>
    </main>
  );
}
