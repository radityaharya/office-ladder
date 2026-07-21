import { createFileRoute } from "@tanstack/react-router";

import { RoomLobbyClient } from "@/components/room/room-lobby-client";

export const Route = createFileRoute("/rooms/$roomId/")({
  component: RoomLobbyPage,
});

function RoomLobbyPage() {
  const { roomId } = Route.useParams();
  return <RoomLobbyClient roomId={roomId} />;
}
