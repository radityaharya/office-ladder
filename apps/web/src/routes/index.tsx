import { createFileRoute, Link } from "@tanstack/react-router";

import { RoomEntryClient } from "@/components/room/room-entry-client";
import { signOut, useSession } from "@/lib/auth-client";

export const Route = createFileRoute("/")({
  component: Home,
});

/**
 * Facts, not marketing claims. Every value here is verified against the engine
 * and content pack: movement is exactly 1d6, the roster floor is 3 members
 * (bot seats included), and reaching rank.director ends the match.
 */
const SPEC_STRIP: readonly (readonly [string, string])[] = [
  ["Roster", "3–6"],
  ["Movement", "1d6"],
  ["Board", "44 desks"],
  ["Track", "Intern → Director"],
];

const SHIFT_STEPS: readonly (readonly [string, string, string])[] = [
  ["01", "Roll", "One six-sided die moves you around the floor."],
  ["02", "Absorb the tile", "Take the money, eat the energy hit, answer the audit."],
  [
    "03",
    "Climb",
    "Promotion is automatic the moment you can afford the next rank. First to Director ends it.",
  ],
];

function Home() {
  const { data: session, isPending } = useSession();
  const username = session?.user.username ?? session?.user.name;

  return (
    <main className="shell-page terminal-grid">
      <div className="shell-frame">
        <div className="shell-bar">
          <div className="shell-bar-group">
            <Link className="shell-label shell-brand" to="/">
              Office Ladder
            </Link>
            <span className="shell-caption shell-medium">/ Internal systems</span>
          </div>

          {isPending ? (
            <span className="shell-status">
              <span className="shell-led shell-led-idle" aria-hidden="true" />
              <span className="shell-label shell-medium">Checking badge</span>
            </span>
          ) : session ? (
            <div className="shell-bar-group">
              <span className="shell-caption shell-medium shell-truncate">
                <span className="shell-label shell-medium">Signed in </span>
                {username}
              </span>
              <button
                type="button"
                className="shell-btn shell-btn-ghost shell-btn-sm"
                onClick={() => void signOut()}
              >
                Sign out
              </button>
            </div>
          ) : (
            <Link className="shell-btn shell-btn-outline shell-btn-sm" to="/sign-in">
              Sign in
            </Link>
          )}
        </div>

        <div className="shell-strip">
          {SPEC_STRIP.map(([label, value]) => (
            <div className="shell-strip-cell" key={label}>
              <span className="shell-label shell-medium">{label}</span>
              <span className="shell-data shell-high">{value}</span>
            </div>
          ))}
        </div>

        {session ? (
          <div className="shell-frame-body">
            <div className="shell-region shell-region-tall shell-stack shell-seam-bottom">
              <span className="shell-label shell-medium">Terminal access — granted</span>
              <h1 className="shell-display shell-high">Pick the next office fight.</h1>
              <p className="shell-body shell-medium shell-prose">
                Open a private room for your group, or enter the code somebody dropped in the
                chat. A room needs three members to start — bot seats count, so you can play
                alone.
              </p>
            </div>

            <RoomEntryClient />
          </div>
        ) : (
          <div className="shell-frame-body">
            <div className="shell-region shell-region-tall shell-stack-wide shell-seam-bottom">
              <div className="shell-stack">
                <span className="shell-label shell-medium">
                  Internal memo — mandatory participation
                </span>
                <h1 className="shell-display shell-high">
                  Everyone wants the corner office. Only one of you gets it.
                </h1>
              </div>
              <p className="shell-body shell-medium shell-prose">
                Deadline Dash is a turn-based board game for three to six coworkers. Roll, take
                the fallout, convert money and reputation into rank, and reach Director before
                anyone else does.
              </p>
              <div className="shell-row-inline">
                <Link className="shell-btn shell-btn-primary shell-btn-lg" to="/sign-up">
                  Create account
                </Link>
                <Link className="shell-btn shell-btn-outline shell-btn-lg" to="/sign-in">
                  Sign in
                </Link>
              </div>
            </div>

            <div className="shell-region-surface shell-seam-bottom">
              <div className="shell-panel-head">
                <span className="shell-label shell-high">Shift structure</span>
                <span className="shell-caption shell-medium">03 steps</span>
              </div>
              <div className="shell-columns shell-columns-three">
                {SHIFT_STEPS.map(([index, title, body]) => (
                  <div className="shell-region shell-stack" key={title}>
                    <div className="shell-strip-cell-inline">
                      <span className="shell-data shell-medium">{index}</span>
                      <span className="shell-label shell-high">{title}</span>
                    </div>
                    <p className="shell-body shell-medium">{body}</p>
                  </div>
                ))}
              </div>
            </div>

            <footer className="shell-region shell-split">
              <span className="shell-label shell-medium">Filed by Facilities</span>
              <span className="shell-label shell-medium">No further action required</span>
            </footer>
          </div>
        )}
      </div>
    </main>
  );
}
