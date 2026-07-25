import { RiUserAddLine } from "@remixicon/react";

type EmptySeatProps = {
  readonly seatNumber: number;
  readonly required: boolean;
};

export function EmptySeat({ seatNumber, required }: EmptySeatProps) {
  return (
    <div
      role="listitem"
      className="flex min-h-20 items-center gap-3 border-b border-dashed border-border px-4 py-4 text-muted-foreground last:border-b-0 sm:px-5"
    >
      <div className="flex size-9 shrink-0 items-center justify-center border border-dashed border-border">
        <RiUserAddLine aria-hidden="true" />
      </div>
      <div className="space-y-1">
        <p className="font-sans text-xs font-semibold tracking-widest uppercase">
          Open seat {seatNumber}
        </p>
        <p className="text-xs">
          {required ? "Required to begin" : "Optional player slot"}
        </p>
      </div>
    </div>
  );
}
