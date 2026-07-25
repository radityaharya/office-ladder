import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { RoomEntryClient } from "@/components/room/room-entry-client";
import { Button, buttonVariants } from "@/components/ui/button";
import { signOut, useSession } from "@/lib/auth-client";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({
  component: Home,
});

const specStrip = [
  ["Roster", "3–6"],
  ["Board", "44 desks"],
  ["Turn", "~30s"],
  ["Track", "Intern → Director"],
] as const;

const steps = [
  ["01", "Roll", "Move across the floor."],
  ["02", "Handle it", "Take the win, eat the fallout."],
  ["03", "Climb", "Convert money and reputation into rank."],
] as const;

const SCRAMBLE_CHARS = "01ABCDEFGHIJKLMNOPQRSTUVWXYZ#%&";

function useScramble(text: string, delayMs = 0) {
  const [display, setDisplay] = useState(text);

  useEffect(() => {
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (reduceMotion) {
      setDisplay(text);
      return;
    }

    let frame = 0;
    let interval: number | undefined;
    const totalFrames = Math.max(text.length * 2, 4);

    const timeout = window.setTimeout(() => {
      interval = window.setInterval(() => {
        frame += 1;
        const lockedCount = Math.ceil((frame / totalFrames) * text.length);
        const next = text
          .split("")
          .map((char, index) => {
            if (index < lockedCount || /[\s–→]/.test(char)) return char;
            return SCRAMBLE_CHARS[
              Math.floor(Math.random() * SCRAMBLE_CHARS.length)
            ];
          })
          .join("");
        setDisplay(next);
        if (frame >= totalFrames) {
          setDisplay(text);
          if (interval !== undefined) window.clearInterval(interval);
        }
      }, 40);
    }, delayMs);

    return () => {
      window.clearTimeout(timeout);
      if (interval !== undefined) window.clearInterval(interval);
    };
  }, [text, delayMs]);

  return display;
}

function ScrambleText({
  className,
  delayMs,
  value,
}: {
  className?: string;
  delayMs?: number;
  value: string;
}) {
  const display = useScramble(value, delayMs);
  return <span className={className}>{display}</span>;
}

function Home() {
  const { data: session, isPending } = useSession();
  const username = session?.user.username ?? session?.user.name;

  return (
    <main className="terminal-grid relative min-h-dvh overflow-hidden bg-background text-foreground">
      <div className="scan-sweep" />

      <span className="ui-data pointer-events-none fixed right-4 bottom-3 z-10 hidden items-center gap-2 text-[0.625rem] text-taupe sm:flex">
        <span className="status-led bg-status-active" />
        REF 44.03 // TERMINAL LIVE
      </span>

      <div className="stagger-reveal mx-auto flex w-full max-w-7xl flex-col">
        <header className="flex h-12 items-center justify-between border-b border-border bg-background px-[clamp(1rem,2.5vw,2rem)]">
          <Link className="ui-label" to="/">
            Office Ladder{" "}
            <span className="text-muted-foreground">/ Internal systems</span>
          </Link>
          {isPending ? (
            <span className="ui-label text-muted-foreground">
              Checking badge
            </span>
          ) : session ? (
            <div className="flex items-center gap-4">
              <span className="hidden text-sm text-muted-foreground sm:inline">
                Signed in as{" "}
                <span className="ui-data text-foreground">{username}</span>
              </span>
              <Button
                onClick={() => void signOut()}
                size="sm"
                variant="ghost"
              >
                Sign out
              </Button>
            </div>
          ) : (
            <Link
              className={buttonVariants({ size: "sm", variant: "outline" })}
              to="/sign-in"
            >
              Sign in
            </Link>
          )}
        </header>

        <div className="hazard-rule" />

        <div className="grid grid-cols-2 border-b border-border bg-background/70 backdrop-blur-[1px] sm:grid-cols-4">
          {specStrip.map(([label, value], index) => (
            <div
              className="flex items-center gap-2 border-r border-border px-[clamp(1rem,2.5vw,2rem)] py-2 last:border-r-0"
              key={label}
            >
              <span className="ui-label text-muted-foreground">{label}</span>
              <ScrambleText
                className="ui-data text-sm text-foreground"
                delayMs={320 + index * 90}
                value={value}
              />
            </div>
          ))}
        </div>

        {session ? (
          <>
            <div className="ruler-rail px-[clamp(1rem,2.5vw,2rem)] py-14 pl-[calc(clamp(1rem,2.5vw,2rem)+1.5rem)]">
              <p className="ui-label text-primary">
                Terminal access — granted
              </p>
              <h1 className="mt-5 max-w-3xl text-4xl font-semibold tracking-[-0.01em] sm:text-6xl">
                Pick the next office fight.
                <span className="blink-caret ml-1 text-primary">_</span>
              </h1>
              <p className="mt-6 max-w-xl text-base leading-8 text-muted-foreground">
                Create a private room for your group, or enter the code
                somebody dropped in the chat.
              </p>
            </div>

            <div className="border-t border-border px-[clamp(1rem,2.5vw,2rem)] py-14">
              <RoomEntryClient />
            </div>
          </>
        ) : (
          <>
            <div className="ruler-rail px-[clamp(1rem,2.5vw,2rem)] py-14 pl-[calc(clamp(1rem,2.5vw,2rem)+1.5rem)] lg:py-20">
              <p className="ui-label text-primary">
                Internal memo — mandatory participation
              </p>
              <h1 className="mt-6 max-w-4xl text-5xl font-semibold tracking-[-0.02em] text-balance sm:text-7xl">
                Everyone wants the corner office. Only one of you gets it.
                <span className="blink-caret ml-1 text-primary">_</span>
              </h1>
              <p className="mt-7 max-w-2xl text-base leading-8 text-muted-foreground sm:text-lg">
                Roll dice, dodge audits, and out-climb five coworkers across
                the floor to reach Director first.
              </p>
              <div className="mt-9 flex flex-col gap-3 sm:flex-row">
                <Link
                  className={cn(buttonVariants({ size: "lg" }), "sm:min-w-48")}
                  to="/sign-up"
                >
                  Create account
                </Link>
                <Link
                  className={cn(
                    buttonVariants({ size: "lg", variant: "outline" }),
                    "sm:min-w-40",
                  )}
                  to="/sign-in"
                >
                  Sign in
                </Link>
              </div>
            </div>

            <div className="border-t border-border bg-card/60 backdrop-blur-[1px]">
              <div className="flex items-center justify-between border-b border-border px-[clamp(1rem,2.5vw,2rem)] py-3">
                <span className="ui-label text-muted-foreground">
                  Shift structure
                </span>
                <span className="ui-data text-[0.625rem] text-taupe">
                  03 STEPS
                </span>
              </div>
              <div className="grid divide-y divide-border sm:grid-cols-3 sm:divide-x sm:divide-y-0">
                {steps.map(([index, title, body], stepIndex) => (
                  <div
                    className="px-[clamp(1rem,2.5vw,2rem)] py-6"
                    key={title}
                  >
                    <div className="flex items-baseline gap-3">
                      <ScrambleText
                        className="ui-data text-sm text-taupe"
                        delayMs={700 + stepIndex * 100}
                        value={index}
                      />
                      <span className="ui-label text-primary">{title}</span>
                    </div>
                    <p className="mt-2 max-w-xs text-sm leading-6 text-muted-foreground">
                      {body}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            <footer className="flex flex-col gap-3 border-t border-border px-[clamp(1rem,2.5vw,2rem)] py-5 sm:flex-row sm:justify-between">
              <span className="ui-label text-muted-foreground">
                Filed by Facilities
              </span>
              <span className="ui-label text-muted-foreground">
                No further action required
              </span>
            </footer>
          </>
        )}
      </div>
    </main>
  );
}
