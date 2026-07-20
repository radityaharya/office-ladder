import { GameClient } from "@/components/game";

type GamePageProps = {
  readonly params: Promise<{ readonly roomId: string }>;
};

export default async function GamePage({ params }: GamePageProps) {
  const { roomId } = await params;

  return <GameClient roomId={roomId} />;
}
