import type { WSContext } from "hono/ws";

const rooms = new Map<string, Set<WSContext>>();

export function registerRoomSocket(roomTopic: string, ws: WSContext): () => void {
  let sockets = rooms.get(roomTopic);
  if (sockets === undefined) {
    sockets = new Set();
    rooms.set(roomTopic, sockets);
  }
  sockets.add(ws);

  return () => {
    sockets?.delete(ws);
    if (sockets?.size === 0) {
      rooms.delete(roomTopic);
    }
  };
}

export function broadcastToRoom(roomTopic: string, payload: unknown): number {
  const sockets = rooms.get(roomTopic);
  if (sockets === undefined || sockets.size === 0) {
    return 0;
  }

  const message = JSON.stringify(payload);
  let sent = 0;
  for (const ws of sockets) {
    try {
      ws.send(message);
      sent += 1;
    } catch {
      sockets.delete(ws);
    }
  }
  return sent;
}
