import type { ReactNode } from "react";

export type BoardSide = "bottom" | "left" | "top" | "right";

export type CornerCoordinate =
  | "bottom-right"
  | "bottom-left"
  | "top-left"
  | "top-right";

export type BoardSpaceKind =
  | "start"
  | "department"
  | "action"
  | "policy"
  | "transit"
  | "safe"
  | "corner";

type BoardSpaceBase = {
  readonly id: string;
  readonly index: number;
  readonly kind: BoardSpaceKind;
  readonly label: string;
  readonly categoryLabel: string;
  readonly detail?: string;
  readonly ownerSeat?: PlayerSeat;
  readonly inactive?: boolean;
};

export type BoardSpaceView =
  | (BoardSpaceBase & {
      readonly placement: "corner";
      readonly coordinate: CornerCoordinate;
    })
  | (BoardSpaceBase & {
      readonly placement: "side";
      readonly side: BoardSide;
      readonly coordinate: number;
    });

export type PlayerSeat = 1 | 2 | 3 | 4 | 5 | 6;

export type PlayerTokenView = {
  readonly id: string;
  readonly name: string;
  readonly seat: PlayerSeat;
  readonly position: number;
  readonly initials?: string;
  readonly state?: "idle" | "current" | "disconnected" | "eliminated";
};

export type BoardIncidentView = {
  readonly title: string;
  readonly status?: string;
  readonly description?: string;
  readonly detail?: ReactNode;
};
