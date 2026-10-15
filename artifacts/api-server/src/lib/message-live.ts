/**
 * In-memory fan-out for message.created.
 * SQL Server remains the source of truth. This map only tracks live sockets.
 * A socket is registered after the access/portal token and H.5.4 session are verified.
 * Events are delivered only to participant user ids supplied by the caller after commit.
 * Clients cannot subscribe to a conversation id.
 */
import type { IncomingMessage } from "node:http";
import type { Server as HttpServer } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { usersRepo, type User } from "@workspace/db";
import { logger } from "./logger";
import { authenticateLiveSocket, liveSessionStillValid, type LiveIdentity } from "./message-live-auth";

const AUTH_TIMEOUT_MS = 5_000;
const SESSION_RECHECK_MS = 60_000;
const MAX_SOCKETS_PER_USER = 6;
const MAX_FRAME_CHARS = 8_192;

export type LiveAudience = "staff" | "portal";

type LiveSocket = WebSocket & { liveUserId?: number };

type LiveTransport = {
  readyState: number;
  send: (data: string) => void;
  close: (code?: number, reason?: string) => void;
  once: (event: "close", listener: () => void) => void;
};

type LiveClient = {
  userId: number;
  audience: LiveAudience;
  socket: LiveTransport;
  sessionPublicId?: string;
};

export type MessageCreatedPayload = {
  type: "message.created";
  conversationId: number;
  message: {
    id: number;
    senderUserId: number;
    senderName: string;
    mine: boolean;
    body: string;
    createdAt: string;
  };
};

const clients = new Map<number, Set<LiveClient>>();

export function resetLiveClientsForTests(): void {
  clients.clear();
}

export function connectedLiveUserIds(): number[] {
  return [...clients.keys()];
}

export function senderLabel(user: Pick<User, "firstName" | "lastName" | "role">, audience: LiveAudience): string {
  if (audience === "portal") {
    if (user.role === "physician") return `Dr. ${user.lastName}, ${user.firstName}`;
    if (user.role === "medical_records") return "ACE Medical Records";
    if (user.role === "super_admin") return "Patient Support";
    return `${user.lastName}, ${user.firstName}`;
  }
  if (user.role === "physician") return `Dr. ${user.lastName}, ${user.firstName}`;
  return `${user.lastName}, ${user.firstName}`;
}

export function messageCreatedEvent(input: {
  conversationId: number;
  senderUserId: number;
  senderName: string;
  mine: boolean;
  body: string;
  createdAt: string;
  messageId: number;
}): MessageCreatedPayload {
  return {
    type: "message.created",
    conversationId: input.conversationId,
    message: {
      id: input.messageId,
      senderUserId: input.senderUserId,
      senderName: input.senderName,
      mine: input.mine,
      body: input.body,
      createdAt: input.createdAt,
    },
  };
}

export function registerLiveClientForTests(client: LiveClient): void {
  addClient(client);
}

function addClient(client: LiveClient): void {
  let set = clients.get(client.userId);
  if (!set) {
    set = new Set();
    clients.set(client.userId, set);
  }
  if (set.size >= MAX_SOCKETS_PER_USER) {
    const oldest = set.values().next().value as LiveClient | undefined;
    if (oldest) {
      set.delete(oldest);
      oldest.socket.close(4000, "Replaced");
    }
  }
  set.add(client);
}

function removeClient(client: LiveClient): void {
  const set = clients.get(client.userId);
  if (!set) return;
  set.delete(client);
  if (set.size === 0) clients.delete(client.userId);
}

/** Deliver one persisted message to the participant sockets currently connected. */
export function deliverPersistedMessage(input: {
  conversationId: number;
  sender: Pick<User, "id" | "firstName" | "lastName" | "role">;
  messageId: number;
  body: string;
  createdAt: string;
  recipientUserIds: number[];
}): void {
  const recipients = new Set(input.recipientUserIds);
  for (const userId of recipients) {
    const set = clients.get(userId);
    if (!set) continue;
    for (const client of set) {
      if (client.socket.readyState !== 1) continue;
      const event = messageCreatedEvent({
        conversationId: input.conversationId,
        senderUserId: input.sender.id,
        senderName: client.userId === input.sender.id ? "You" : senderLabel(input.sender, client.audience),
        mine: client.userId === input.sender.id,
        body: input.body,
        createdAt: input.createdAt,
        messageId: input.messageId,
      });
      client.socket.send(JSON.stringify(event));
    }
  }
}

export function deliverConversationDeleted(input: {
  conversationId: number;
  recipientUserIds: number[];
}): void {
  const payload = JSON.stringify({
    type: "conversation.deleted",
    conversationId: input.conversationId,
  });
  for (const userId of new Set(input.recipientUserIds)) {
    const set = clients.get(userId);
    if (!set) continue;
    for (const client of set) {
      if (client.socket.readyState !== 1) continue;
      client.socket.send(payload);
    }
  }
}

export async function publishPersistedMessage(input: {
  conversationId: number;
  senderUserId: number;
  messageId: number;
  body: string;
  createdAt: Date | string;
  recipientUserIds: number[];
}): Promise<void> {
  const sender = await usersRepo.findUserById(input.senderUserId);
  const createdAt =
    input.createdAt instanceof Date ? input.createdAt.toISOString() : new Date(input.createdAt).toISOString();
  deliverPersistedMessage({
    conversationId: input.conversationId,
    sender: sender ?? {
      id: input.senderUserId,
      firstName: "User",
      lastName: "",
      role: "medical_records",
    },
    messageId: input.messageId,
    body: input.body,
    createdAt,
    recipientUserIds: input.recipientUserIds,
  });
}

function safeSend(socket: WebSocket, payload: unknown): void {
  if (socket.readyState !== socket.OPEN) return;
  socket.send(JSON.stringify(payload));
}

function bindAuthenticatedSocket(socket: LiveSocket, identity: LiveIdentity): LiveClient {
  const client: LiveClient = {
    userId: identity.userId,
    audience: identity.audience,
    socket: socket as unknown as LiveTransport,
    sessionPublicId: identity.sessionPublicId,
  };
  socket.liveUserId = identity.userId;
  addClient(client);
  if (identity.sessionPublicId) {
    const timer = setInterval(() => {
      void liveSessionStillValid(identity)
        .then((ok) => {
          if (!ok) socket.close(4001, "Unauthorized");
        })
        .catch(() => socket.close(4001, "Unauthorized"));
    }, SESSION_RECHECK_MS);
    socket.once("close", () => clearInterval(timer));
  }
  return client;
}

export function attachMessageLiveServer(server: HttpServer): WebSocketServer {
  const wss = new WebSocketServer({ server, path: "/api/messages/live" });

  wss.on("connection", (socket: LiveSocket, req: IncomingMessage) => {
    const pathOnly = req.url?.split("?")[0] ?? "";
    if (pathOnly !== "/api/messages/live") {
      socket.close(4001, "Unauthorized");
      return;
    }

    let client: LiveClient | null = null;
    const authTimer = setTimeout(() => {
      if (!client) socket.close(4001, "Unauthorized");
    }, AUTH_TIMEOUT_MS);

    socket.on("message", (raw) => {
      const text = raw.toString();
      if (text.length > MAX_FRAME_CHARS) {
        socket.close(4001, "Unauthorized");
        return;
      }
      let frame: { type?: string; token?: string; conversationId?: unknown };
      try {
        frame = JSON.parse(text) as { type?: string; token?: string };
      } catch {
        socket.close(4001, "Unauthorized");
        return;
      }

      if (!client) {
        if (frame.type !== "auth" || typeof frame.token !== "string" || !frame.token) {
          socket.close(4001, "Unauthorized");
          return;
        }
        void authenticateLiveSocket(frame.token)
          .then((identity) => {
            if (!identity || socket.readyState !== socket.OPEN) {
              socket.close(4001, "Unauthorized");
              return;
            }
            clearTimeout(authTimer);
            client = bindAuthenticatedSocket(socket, identity);
            safeSend(socket, { type: "ready" });
          })
          .catch((err) => {
            logger.error({ err }, "Message live auth failed");
            socket.close(4001, "Unauthorized");
          });
        return;
      }

      if (frame.type === "subscribe") {
        safeSend(socket, { type: "error", error: "Not allowed" });
      }
    });

    socket.on("close", () => {
      clearTimeout(authTimer);
      if (client) removeClient(client);
    });

    socket.on("error", () => {
      socket.close();
    });
  });

  return wss;
}
