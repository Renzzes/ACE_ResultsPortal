import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { markMessageThreadRead, markPortalMessageThreadRead } from "@/lib/comms-api";
import {
  applyThreadListUpdate,
  reconnectDelayMs,
  type LiveMessageEvent,
  type ThreadListItem,
} from "@/lib/message-live-state";

export type { LiveMessageEvent } from "@/lib/message-live-state";
export { appendMessageById, applyThreadListUpdate, reconnectDelayMs } from "@/lib/message-live-state";

export type LiveStatus = "connecting" | "connected" | "reconnecting";

function liveUrl(): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/api/messages/live`;
}

export function useMessageLive(options: {
  enabled: boolean;
  getToken: () => string | null;
  scope: "staff" | "portal";
  activeThreadId: number | null;
  onConversationDeleted?: (conversationId: number) => void;
}) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<LiveStatus>("connecting");
  const activeRef = useRef(options.activeThreadId);
  const getTokenRef = useRef(options.getToken);
  const onDeletedRef = useRef(options.onConversationDeleted);
  const seenRef = useRef(new Set<number>());
  activeRef.current = options.activeThreadId;
  getTokenRef.current = options.getToken;
  onDeletedRef.current = options.onConversationDeleted;

  useEffect(() => {
    if (!options.enabled) {
      setStatus("connecting");
      return;
    }

    let stopped = false;
    let attempt = 0;
    let sawReady = false;
    let socket: WebSocket | null = null;
    let timer: number | undefined;

    const threadsKey = options.scope === "portal" ? ["portal-messages-threads"] : ["message-threads"];
    const threadKey = (id: number) =>
      options.scope === "portal" ? ["portal-messages-thread", id] : ["message-thread", id];

    const applyEvent = (event: LiveMessageEvent) => {
      if (seenRef.current.has(event.message.id)) return;
      seenRef.current.add(event.message.id);
      if (seenRef.current.size > 500) {
        const first = seenRef.current.values().next().value as number | undefined;
        if (first != null) seenRef.current.delete(first);
      }

      const activeId = activeRef.current;
      queryClient.setQueryData(threadKey(event.conversationId), (old: unknown) => {
        if (!old || typeof old !== "object") return old;
        const thread = old as {
          messages: { data: Array<Record<string, unknown>>; total: number };
        };
        const data = thread.messages?.data;
        if (!Array.isArray(data)) return old;
        if (data.some((row) => row.id === event.message.id)) return old;
        const mapped =
          options.scope === "portal"
            ? {
                id: event.message.id,
                threadId: event.conversationId,
                mine: event.message.mine,
                senderName: event.message.mine ? "You" : event.message.senderName,
                body: event.message.body,
                isDeleted: false,
                createdAt: event.message.createdAt,
              }
            : {
                id: event.message.id,
                threadId: event.conversationId,
                senderUserId: event.message.senderUserId,
                senderName: event.message.senderName,
                body: event.message.body,
                isDeleted: false,
                createdAt: event.message.createdAt,
              };
        return {
          ...thread,
          messages: {
            ...thread.messages,
            data: [...data, mapped],
            total: thread.messages.total + 1,
          },
        };
      });

      let found = false;
      queryClient.setQueryData(threadsKey, (old: unknown) => {
        if (!old || typeof old !== "object" || !("data" in old)) return old;
        const list = old as { data: ThreadListItem[] };
        if (!Array.isArray(list.data)) return old;
        const next = applyThreadListUpdate(list.data, event, activeId);
        found = next.found;
        return next.found ? { ...list, data: next.threads } : old;
      });
      if (!found) void queryClient.invalidateQueries({ queryKey: threadsKey });

      if (activeId === event.conversationId && !event.message.mine) {
        const mark =
          options.scope === "portal"
            ? markPortalMessageThreadRead(event.conversationId)
            : markMessageThreadRead(event.conversationId);
        void mark.catch(() => undefined);
      }

      if (!event.message.mine) {
        if (options.scope === "portal") {
          void queryClient.invalidateQueries({ queryKey: ["portal-messages-unread"] });
          void queryClient.invalidateQueries({ queryKey: ["portal-notifications-unread"] });
        } else {
          void queryClient.invalidateQueries({ queryKey: ["message-unread-count"] });
          void queryClient.invalidateQueries({ queryKey: ["notifications-unread"] });
        }
      }
    };

    const connect = () => {
      if (stopped) return;
      const token = getTokenRef.current();
      if (!token) return;
      const ws = new WebSocket(liveUrl());
      socket = ws;
      ws.onopen = () => {
        ws.send(JSON.stringify({ type: "auth", token }));
      };
      ws.onmessage = (incoming) => {
        let frame: { type?: string; conversationId?: number; message?: LiveMessageEvent["message"] };
        try {
          frame = JSON.parse(String(incoming.data)) as typeof frame;
        } catch {
          return;
        }
        if (frame.type === "ready") {
          setStatus("connected");
          if (sawReady) {
            void queryClient.invalidateQueries({ queryKey: threadsKey });
            const openId = activeRef.current;
            if (openId != null) void queryClient.invalidateQueries({ queryKey: threadKey(openId) });
          }
          sawReady = true;
          attempt = 0;
          return;
        }
        if (frame.type === "conversation.deleted" && frame.conversationId) {
          const deletedId = frame.conversationId;
          onDeletedRef.current?.(deletedId);
          queryClient.setQueryData(threadsKey, (old: unknown) => {
            if (!old || typeof old !== "object" || !("data" in old)) return old;
            const list = old as { data: Array<{ id: number }>; total?: number };
            if (!Array.isArray(list.data)) return old;
            const data = list.data.filter((row) => row.id !== deletedId);
            const removed = list.data.length - data.length;
            return {
              ...list,
              data,
              total: list.total != null ? Math.max(0, list.total - removed) : list.total,
            };
          });
          queryClient.removeQueries({ queryKey: threadKey(deletedId) });
          return;
        }
        if (frame.type === "message.created" && frame.message && frame.conversationId) {
          applyEvent({
            type: "message.created",
            conversationId: frame.conversationId,
            message: frame.message,
          });
        }
      };
      ws.onclose = () => {
        if (stopped) return;
        setStatus(sawReady ? "reconnecting" : "reconnecting");
        const delay = reconnectDelayMs(attempt);
        attempt += 1;
        timer = window.setTimeout(connect, delay);
      };
    };

    connect();
    return () => {
      stopped = true;
      if (timer != null) window.clearTimeout(timer);
      socket?.close();
    };
    // Token identity is read on each attempt. Reconnect when the session token changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.enabled, options.scope, queryClient]);

  return status;
}
