import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { RoomLobbyClient } from "@/components/room/room-lobby-client";
import { auth } from "@/lib/auth";

export default async function RoomLobbyPage({
  params,
}: {
  readonly params: Promise<{ readonly roomId: string }>;
}) {
  const session = await auth.api.getSession({
    headers: await headers(),
    query: { disableCookieCache: true },
  });

  if (session === null) redirect("/sign-in");

  const { roomId } = await params;
  return <RoomLobbyClient roomId={roomId} />;
}
