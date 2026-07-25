import { RoomCodeCopyButton } from "./room-code-copy-button";

type RoomHeaderProps = {
  readonly roomCode: string;
  readonly playerCount: number;
  readonly title?: string;
  readonly description?: string;
};

export function RoomHeader({
  roomCode,
  playerCount,
  title = "Team assembly",
  description = "Choose a character, mark ready, and wait for the host to start.",
}: RoomHeaderProps) {
  return (
    <header className="surface-panel flex flex-col gap-6 p-5 sm:flex-row sm:items-end sm:justify-between sm:p-6">
      <div className="max-w-2xl space-y-2">
        <p className="font-sans text-xs font-semibold tracking-widest text-primary uppercase">
          Private room
        </p>
        <h1 className="font-heading text-3xl font-semibold tracking-tight text-foreground">
          {title}
        </h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          {description}
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-6 sm:justify-end">
        <div className="space-y-1">
          <p className="font-sans text-xs font-semibold tracking-widest text-muted-foreground uppercase">
            Occupancy
          </p>
          <p className="font-heading text-lg font-semibold text-foreground">
            {playerCount} active
          </p>
          <p className="text-xs text-muted-foreground">3–6 players</p>
        </div>
        <div className="space-y-1">
          <p className="font-sans text-xs font-semibold tracking-widest text-muted-foreground uppercase">
            Room code
          </p>
          <div className="flex items-center gap-3">
            <code className="font-mono text-lg font-semibold tracking-widest text-foreground">
              {roomCode}
            </code>
            <RoomCodeCopyButton roomCode={roomCode} />
          </div>
        </div>
      </div>
    </header>
  );
}
