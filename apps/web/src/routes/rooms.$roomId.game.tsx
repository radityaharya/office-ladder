import { createFileRoute } from "@tanstack/react-router";
import { domAnimation, LazyMotion } from "motion/react";

import { GameClient } from "@/components/game";

export const Route = createFileRoute("/rooms/$roomId/game")({
  component: GamePage,
});

/**
 * The match view's single `LazyMotion` provider.
 *
 * Everything under here that animates renders `m.*` from `motion/react-m` rather
 * than the full `motion.*` component tree — player tokens, the dice readout, the
 * card notice, the prompt dialog and the activity-log rows. `m` components are
 * inert without a `LazyMotion` ancestor, so this provider is load-bearing, not an
 * optimisation that can be dropped.
 *
 * Two deliberate choices:
 *
 * - **`domAnimation`, not `domMax`.** Nothing in the match uses drag or layout
 *   projection: the board's dock offsets are computed in JS rather than measured,
 *   and every animation is opacity/transform. `domMax` would pull the layout
 *   projection engine in for nothing.
 * - **Mounted on the ROUTE, not in `client.tsx`.** Motion sits entirely inside
 *   this route's chunk; hoisting the provider to the app entry would move the
 *   feature bundle into the initial payload and make sign-in pay for the board's
 *   animations. Route level is as high as the tree goes without doing that.
 *
 * Not `strict`. Strict mode throws the moment a full `motion.*` component renders
 * inside, which would take the whole board down in the browser rather than merely
 * costing bundle size — a bad trade in a repo where nothing animated is
 * unit-testable (apps/web's vitest environment is `node`: no jsdom). The
 * invariant is enforced by review instead: `grep -rnE '</?motion\.' apps/web/src`
 * must stay empty.
 */
function GamePage() {
  const { roomId } = Route.useParams();
  return (
    <LazyMotion features={domAnimation}>
      <GameClient roomId={roomId} />
    </LazyMotion>
  );
}
