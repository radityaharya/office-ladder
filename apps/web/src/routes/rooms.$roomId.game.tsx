import { createFileRoute, redirect } from "@tanstack/react-router";

import { GameClient } from "@/components/game";
import { authClient } from "@/lib/auth-client";

export const Route = createFileRoute("/rooms/$roomId/game")({
  beforeLoad: async () => {
    const { data: session } = await authClient.getSession();
    if (session === null) {
      throw redirect({ to: "/sign-in" });
    }
  },
  component: GamePage,
});

function GamePage() {
  const { roomId } = Route.useParams();
  return <GameClient roomId={roomId} />;
}
