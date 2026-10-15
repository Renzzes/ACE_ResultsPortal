export type LiveMessageEvent = {
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

export type ThreadListItem = {
  id: number;
  unreadCount: number;
  lastMessagePreview: string | null;
  lastMessageAt: string | null;
  updatedAt: string;
};

export function reconnectDelayMs(attempt: number): number {
  const step = Math.min(Math.max(attempt, 0), 5);
  return Math.min(30_000, 1_000 * 2 ** step);
}

export function applyThreadListUpdate<T extends ThreadListItem>(
  threads: T[],
  event: LiveMessageEvent,
  activeId: number | null,
): { threads: T[]; found: boolean } {
  const index = threads.findIndex((thread) => thread.id === event.conversationId);
  if (index < 0) return { threads, found: false };
  const current = threads[index]!;
  const open = activeId === event.conversationId;
  const updated: T = {
    ...current,
    lastMessagePreview: event.message.body.slice(0, 160),
    lastMessageAt: event.message.createdAt,
    updatedAt: event.message.createdAt,
    unreadCount: open || event.message.mine ? (open ? 0 : current.unreadCount) : current.unreadCount + 1,
  };
  const rest = threads.filter((thread) => thread.id !== event.conversationId);
  return { threads: [updated, ...rest], found: true };
}

export function removeConversation<T extends { id: number }>(threads: T[], conversationId: number): T[] {
  return threads.filter((thread) => thread.id !== conversationId);
}

export function appendMessageById<T extends { id: number }>(messages: T[], message: T): T[] {
  if (messages.some((row) => row.id === message.id)) return messages;
  return [...messages, message];
}
