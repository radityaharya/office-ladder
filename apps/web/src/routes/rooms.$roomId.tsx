import { createFileRoute, redirect } from "@tanstack/react-router";

import { RoomLobbyClient } from "@/components/room/room-lobby-client";
import { authClient } from "@/lib/auth-client";

export const Route = createFileRoute("/rooms/$roomId")({
  beforeLoad: async () => {
    const { data: session } = await authClient.getSession();
    if (session === null) {
      throw redirect({ to: "/sign-in" });
    }
  },
  component: RoomLobbyPage,
});

function RoomLobbyPage() {
  const { roomId } = Route.useParams();
  return <RoomLobbyClient roomId={roomId} />;
}
