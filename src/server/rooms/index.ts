export { roomRepository, roomService } from "./default-service";
export { InMemoryRoomRepository } from "./in-memory-repository";
export { createRoomService } from "./service";
export type {
  ActiveStoredRoom,
  BootstrapRoomInput,
  CreateRoomInput,
  JoinRoomByCodeInput,
  JoinRoomInput,
  RollRoomInput,
  RoomActorInput,
  RoomRepository,
  RoomService,
  RoomServiceDependencies,
  RoomServiceError,
  RoomServiceErrorCode,
  RoomServiceResult,
  StoredRoom,
} from "./service";
