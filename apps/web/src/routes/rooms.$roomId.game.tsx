import { createFileRoute } from "@tanstack/react-router";

import { GameClient } from "@/components/game";

export const Route = createFileRoute("/rooms/$roomId/game")({
  component: GamePage,
});

function GamePage() {
  const { roomId } = Route.useParams();
  return <GameClient roomId={roomId} />;
}
