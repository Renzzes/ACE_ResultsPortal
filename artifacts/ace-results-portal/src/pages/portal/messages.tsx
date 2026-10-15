import { useEffect, useRef, useState, type FormEvent } from "react";
import { Redirect } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PatientLayout } from "@/components/layout/patient-layout";
import { ConversationActionSheet, DeleteConversationDialog } from "@/components/comms/delete-conversation-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/lib/auth";
import {
  closePortalMessageThread,
  createPortalMessageThread,
  deletePortalMessageThread,
  fetchPortalMessageRecipients,
  fetchPortalMessageThread,
  fetchPortalMessageThreads,
  sendPortalMessage,
} from "@/lib/comms-api";
import { enterSendsMessage, messageBodyToSend } from "@/lib/message-composer";
import { useMessageLive } from "@/lib/message-live";
import { usePersistedThreadId } from "@/lib/thread-selection";
import { useRowLongPress } from "@/lib/use-row-long-press";
import { PORTAL_TOKEN_KEY } from "@/lib/workflow-stability";
import { formatRelativeTime } from "@/lib/notification-utils";
import { ArrowLeft, MessageCircle, MoreVertical, Plus, Send, X } from "lucide-react";

function portalRecipientSubtitle(role: string) {
  if (role === "physician") return "Assigned physician";
  if (role === "medical_records") return "Medical Records";
  if (role === "super_admin") return "Patient Support";
  return "Care team";
}

function initials(name: string) {
  return name
    .replace(/^Dr\.\s*/i, "")
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export default function PortalMessagesPage() {
  const { portalAuth } = useAuth();
  const queryClient = useQueryClient();
  const { activeId, setActiveId } = usePersistedThreadId();
  const [mobileChat, setMobileChat] = useState(() => {
    const id = Number(new URLSearchParams(window.location.search).get("threadId"));
    return Number.isInteger(id) && id > 0;
  });
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [actionThreadId, setActionThreadId] = useState<number | null>(null);
  const sendingRef = useRef(false);
  const { bind: bindLongPress, consumeSuppressedClick } = useRowLongPress((id) => {
    setActionThreadId(id);
  });
  const liveStatus = useMessageLive({
    enabled: Boolean(portalAuth.token),
    scope: "portal",
    activeThreadId: activeId,
    getToken: () => sessionStorage.getItem(PORTAL_TOKEN_KEY),
    onConversationDeleted: (id) => {
      if (activeId === id) {
        setActiveId(null);
        setMobileChat(false);
      }
      if (confirmDeleteId === id) setConfirmDeleteId(null);
      if (actionThreadId === id) setActionThreadId(null);
    },
  });
  const [composeOpen, setComposeOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [recipientSearch, setRecipientSearch] = useState("");
  const [debouncedRecipientSearch, setDebouncedRecipientSearch] = useState("");
  const [sendError, setSendError] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedRecipientSearch(recipientSearch.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [recipientSearch]);
  const endRef = useRef<HTMLDivElement>(null);

  const threadsQuery = useQuery({
    queryKey: ["portal-messages-threads"],
    queryFn: () => fetchPortalMessageThreads({ page: 1, limit: 50 }),
    enabled: Boolean(portalAuth.token),
    refetchOnWindowFocus: true,
  });

  const recipientsQuery = useQuery({
    queryKey: ["portal-messages-recipients", debouncedRecipientSearch],
    queryFn: () => fetchPortalMessageRecipients(debouncedRecipientSearch),
    enabled: Boolean(portalAuth.token) && composeOpen && debouncedRecipientSearch.length >= 2,
  });

  const threadQuery = useQuery({
    queryKey: ["portal-messages-thread", activeId],
    queryFn: () => fetchPortalMessageThread(activeId!),
    enabled: Boolean(portalAuth.token) && activeId != null,
  });

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [threadQuery.data?.messages.data.length, activeId]);

  useEffect(() => {
    if (activeId == null || !threadQuery.isError) return;
    // Unauthorized / missing threadId must not keep a stuck selection or leak state.
    setActiveId(null);
    setMobileChat(false);
  }, [activeId, setActiveId, threadQuery.isError]);

  const createMut = useMutation({
    mutationFn: (recipientUserId: number) => createPortalMessageThread({ recipientUserId }),
    onSuccess: (created) => {
      setComposeOpen(false);
      setRecipientSearch("");
      setDebouncedRecipientSearch("");
      setSendError(null);
      void queryClient.invalidateQueries({ queryKey: ["portal-messages-threads"] });
      void queryClient.invalidateQueries({ queryKey: ["portal-messages-unread"] });
      void queryClient.invalidateQueries({ queryKey: ["portal-notifications-unread"] });
      setActiveId(created.id);
      setMobileChat(true);
    },
    onError: () => setSendError("Unable to open conversation. Please try again."),
  });

  const sendMut = useMutation({
    mutationFn: (body: string) => sendPortalMessage(activeId!, body),
    onSuccess: () => {
      setDraft("");
      setSendError(null);
      void queryClient.invalidateQueries({ queryKey: ["portal-messages-thread", activeId] });
      void queryClient.invalidateQueries({ queryKey: ["portal-messages-threads"] });
      void queryClient.invalidateQueries({ queryKey: ["portal-messages-unread"] });
      void queryClient.invalidateQueries({ queryKey: ["portal-notifications-unread"] });
    },
    onError: () => setSendError("Unable to send message. Please try again."),
  });

  const deleteMut = useMutation({
    mutationFn: (threadId: number) => deletePortalMessageThread(threadId),
    onSuccess: (_result, threadId) => {
      if (activeId === threadId) {
        setActiveId(null);
        setMobileChat(false);
      }
      setConfirmDeleteId(null);
      setActionThreadId(null);
      queryClient.removeQueries({ queryKey: ["portal-messages-thread", threadId] });
      void queryClient.invalidateQueries({ queryKey: ["portal-messages-threads"] });
    },
  });

  const closeMut = useMutation({
    mutationFn: () => closePortalMessageThread(activeId!),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["portal-messages-thread", activeId] });
      void queryClient.invalidateQueries({ queryKey: ["portal-messages-threads"] });
    },
  });

  if (!portalAuth.patient || !portalAuth.token) {
    return <Redirect to="/login" />;
  }

  const threads = threadsQuery.data?.data ?? [];
  const activeThread = threadQuery.data;
  const counterpartName =
    activeThread?.participants[0]?.name ??
    threads.find((t) => t.id === activeId)?.counterpart?.name ??
    "Conversation";

  const openThread = (id: number) => {
    setActiveId(id);
    setMobileChat(true);
    setSendError(null);
  };

  const submitReply = (event?: FormEvent) => {
    event?.preventDefault();
    const text = messageBodyToSend(draft, sendMut.isPending || sendingRef.current);
    if (!text || activeId == null || activeThread?.isClosed) return;
    setSendError(null);
    sendingRef.current = true;
    sendMut.mutate(text, {
      onSettled: () => {
        sendingRef.current = false;
      },
    });
  };

  return (
    <PatientLayout title="MESSAGES" fill>
      <div className="flex h-[calc(100dvh-7.25rem)] flex-col overflow-hidden rounded-2xl border border-[#DDE5E0] bg-white shadow-[0_4px_16px_rgb(21_61_43_/_0.05)] lg:h-full lg:min-h-0">
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[#DDE5E0] bg-[#F6F9F7] px-4 py-2">
          <p className="text-[12px] text-[#64706A]">
            You can message assigned doctors, Medical Records, and Patient Support.
          </p>
          <button
            type="button"
            onClick={() => {
              setComposeOpen(true);
              setRecipientSearch("");
              setSendError(null);
            }}
            className="inline-flex items-center gap-1 rounded-full bg-[#2F7D4A] px-3 py-1.5 text-xs font-semibold text-white"
          >
            <Plus className="h-3.5 w-3.5" />
            New Message
          </button>
        </div>

        <div className="flex min-h-0 flex-1">
          <aside
            className={`${mobileChat ? "hidden" : "flex"} min-h-0 w-full flex-col lg:flex lg:w-[300px] lg:border-r lg:border-[#DDE5E0]`}
          >
            <div className="flex items-center gap-2 border-b border-[#DDE5E0] px-4 py-3">
              <MessageCircle className="h-4 w-4 text-[#2F7D4A]" />
              <h2 className="text-[15px] font-semibold text-[#17221D]">
                Conversations
                <span className="ml-2 text-[11px] font-medium text-[#64706A]">
                  {liveStatus === "connected"
                    ? "Connected"
                    : liveStatus === "reconnecting"
                      ? "Reconnecting..."
                      : "Connecting"}
                </span>
              </h2>
            </div>

            {threadsQuery.isLoading ? (
              <div className="space-y-2 p-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="h-16 animate-pulse rounded-xl bg-[#E8F4EC]/60" />
                ))}
              </div>
            ) : null}

            {threadsQuery.isError ? (
              <div className="px-4 py-10 text-center text-sm text-[#64706A]">
                Unable to load messages. Please try again.
                <button
                  type="button"
                  className="mt-2 block w-full font-semibold text-[#2F7D4A]"
                  onClick={() => void threadsQuery.refetch()}
                >
                  Retry
                </button>
              </div>
            ) : null}

            {!threadsQuery.isLoading && !threadsQuery.isError && threads.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-[#64706A]">No messages yet.</p>
            ) : null}

            <ul className="min-h-0 flex-1 overflow-y-auto">
              {threads.map((thread) => {
                const selected = thread.id === activeId;
                const title = thread.counterpart?.name ?? thread.subject;
                return (
                  <li key={thread.id} className={`flex items-stretch ${selected ? "bg-[#E8F4EC]" : ""}`}>
                    <button
                      type="button"
                      onClick={() => {
                        if (consumeSuppressedClick()) return;
                        openThread(thread.id);
                      }}
                      className={`flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left ${
                        selected ? "" : "hover:bg-[#F6F9F7]"
                      }`}
                      {...bindLongPress(thread.id)}
                    >
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#E8F4EC] text-[11px] font-bold text-[#2F7D4A]">
                        {initials(title)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <p className="truncate text-sm font-semibold text-[#17221D]">{title}</p>
                          <span className="shrink-0 text-[11px] text-[#64706A]">
                            {thread.lastMessageAt
                              ? formatRelativeTime(thread.lastMessageAt)
                              : formatRelativeTime(thread.updatedAt)}
                          </span>
                        </div>
                        <p className="truncate text-[12px] text-[#64706A]">{thread.subject}</p>
                        <p className="truncate text-[12px] text-[#64706A]">
                          {thread.lastMessagePreview ?? "No messages yet"}
                        </p>
                      </div>
                      {thread.unreadCount > 0 ? (
                        <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-[#2F7D4A] px-1 text-[10px] font-bold text-white">
                          {thread.unreadCount > 99 ? "99+" : thread.unreadCount}
                        </span>
                      ) : null}
                    </button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          className="shrink-0 self-center rounded-lg p-2 text-[#64706A]"
                          aria-label={`Conversation actions for ${title}`}
                          onPointerDown={(event) => event.stopPropagation()}
                        >
                          <MoreVertical className="h-4 w-4" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onSelect={() => setConfirmDeleteId(thread.id)}
                        >
                          Delete conversation
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </li>
                );
              })}
            </ul>
          </aside>

          <section className={`${mobileChat ? "flex" : "hidden"} min-h-0 min-w-0 flex-1 flex-col lg:flex`}>
            {activeId == null ? (
              <div className="flex flex-1 items-center justify-center text-sm text-[#64706A]">
                Select a conversation or search for someone you can message.
              </div>
            ) : threadQuery.isLoading ? (
              <div className="flex flex-1 items-center justify-center text-sm text-[#64706A]">Loading…</div>
            ) : threadQuery.isError ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 text-sm text-[#64706A]">
                Unable to load messages. Please try again.
                <button
                  type="button"
                  className="font-semibold text-[#2F7D4A]"
                  onClick={() => void threadQuery.refetch()}
                >
                  Retry
                </button>
              </div>
            ) : activeThread ? (
              <>
                <header className="flex shrink-0 items-center gap-3 border-b border-[#DDE5E0] px-3 py-3 sm:px-4">
                  <button
                    type="button"
                    className="p-1 text-[#64706A] lg:hidden"
                    onClick={() => setMobileChat(false)}
                    aria-label="Back to conversations"
                  >
                    <ArrowLeft className="h-5 w-5" />
                  </button>
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#E8F4EC] text-[11px] font-bold text-[#2F7D4A]">
                    {initials(counterpartName)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-[#17221D]">{counterpartName}</p>
                    <p className="truncate text-[12px] text-[#2F7D4A]">{activeThread.subject}</p>
                  </div>
                  {!activeThread.isClosed ? (
                    <button
                      type="button"
                      className="text-xs font-semibold text-[#64706A] hover:text-[#8E3344]"
                      onClick={() => closeMut.mutate()}
                      disabled={closeMut.isPending}
                    >
                      Close
                    </button>
                  ) : (
                    <span className="text-xs font-semibold text-[#8E3344]">Closed</span>
                  )}
                </header>

                <div className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-[#F6F9F7] px-3 py-4 sm:px-5">
                  {activeThread.messages.data.map((message) => (
                    <div
                      key={message.id}
                      className={`flex ${message.mine ? "justify-end" : "justify-start"}`}
                    >
                      <div className={`max-w-[82%] sm:max-w-[70%] ${message.mine ? "items-end" : ""}`}>
                        <div
                          className={`px-3.5 py-2 text-sm leading-relaxed break-words ${
                            message.mine
                              ? "rounded-[18px] rounded-br-md bg-[#2F7D4A] text-white"
                              : "rounded-[18px] rounded-bl-md border border-[#DDE5E0] bg-white text-[#17221D]"
                          }`}
                        >
                          {message.body}
                        </div>
                        <p
                          className={`mt-1 text-[10px] text-[#64706A] ${
                            message.mine ? "text-right" : ""
                          }`}
                        >
                          {message.senderName} · {formatRelativeTime(message.createdAt)}
                        </p>
                      </div>
                    </div>
                  ))}
                  <div ref={endRef} />
                </div>

                {activeThread.isClosed ? (
                  <p className="shrink-0 border-t border-[#DDE5E0] px-4 py-3 text-center text-sm text-[#64706A]">
                    This conversation is closed.
                  </p>
                ) : (
                  <form
                    className="flex shrink-0 items-center gap-2 border-t border-[#DDE5E0] bg-white px-3 py-3 sm:px-4"
                    onSubmit={submitReply}
                  >
                    <textarea
                      value={draft}
                      onChange={(event) => setDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (!enterSendsMessage(event.nativeEvent)) return;
                        event.preventDefault();
                        submitReply();
                      }}
                      placeholder={`Message ${counterpartName}`}
                      maxLength={4000}
                      rows={1}
                      disabled={sendMut.isPending}
                      className="max-h-32 min-h-10 min-w-0 flex-1 resize-none rounded-2xl border border-[#DDE5E0] bg-[#F6F9F7] px-4 py-2 text-sm text-[#17221D] outline-none focus:border-[#2F7D4A]"
                    />
                    <button
                      type="submit"
                      disabled={!draft.trim() || sendMut.isPending}
                      className="flex h-10 w-10 items-center justify-center rounded-full bg-[#2F7D4A] text-white disabled:opacity-40"
                      aria-label="Send"
                    >
                      <Send className="h-4 w-4" />
                    </button>
                  </form>
                )}
                {sendError ? (
                  <p className="shrink-0 px-4 pb-3 text-center text-xs text-[#8E3344]">{sendError}</p>
                ) : null}
              </>
            ) : null}
          </section>
        </div>
      </div>

      {composeOpen ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 p-4 sm:items-center">
          <div className="w-full max-w-md rounded-2xl border border-[#DDE5E0] bg-white p-5 shadow-lg">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-[#17221D]">New conversation</h3>
              <button
                type="button"
                onClick={() => setComposeOpen(false)}
                className="rounded-full p-1 text-[#64706A] hover:bg-[#F6F9F7]"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <input
              value={recipientSearch}
              onChange={(event) => setRecipientSearch(event.target.value)}
              placeholder="Search people..."
              autoFocus
              className="mb-3 h-10 w-full rounded-lg border border-[#DDE5E0] bg-[#F6F9F7] px-3 text-sm text-[#17221D] outline-none focus:border-[#2F7D4A]"
            />

            <div className="max-h-64 overflow-y-auto rounded-xl border border-[#DDE5E0]">
              {debouncedRecipientSearch.length < 2 ? (
                <p className="px-3 py-6 text-sm text-[#64706A]">
                  Search assigned doctors, Medical Records, or Patient Support.
                </p>
              ) : recipientsQuery.isFetching ? (
                <p className="px-3 py-6 text-sm text-[#64706A]">Searching…</p>
              ) : recipientsQuery.isError ? (
                <p className="px-3 py-6 text-sm text-[#8E3344]">Unable to search people.</p>
              ) : (recipientsQuery.data?.data.length ?? 0) === 0 ? (
                <p className="px-3 py-6 text-sm text-[#64706A]">No matching people.</p>
              ) : (
                <ul>
                  {(recipientsQuery.data?.data ?? []).map((recipient) => (
                    <li key={recipient.id} className="border-b border-[#DDE5E0] last:border-b-0">
                      <button
                        type="button"
                        disabled={createMut.isPending}
                        className="flex w-full flex-col px-3 py-3 text-left hover:bg-[#F6F9F7] disabled:opacity-60"
                        onClick={() => createMut.mutate(recipient.id)}
                      >
                        <span className="text-sm font-semibold text-[#17221D]">{recipient.name}</span>
                        <span className="text-xs text-[#64706A]">{portalRecipientSubtitle(recipient.role)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {sendError ? <p className="mt-3 text-xs text-[#8E3344]">{sendError}</p> : null}
          </div>
        </div>
      ) : null}
      <ConversationActionSheet
        open={actionThreadId != null}
        onClose={() => setActionThreadId(null)}
        onDelete={() => {
          if (actionThreadId == null) return;
          setConfirmDeleteId(actionThreadId);
          setActionThreadId(null);
        }}
      />
      <DeleteConversationDialog
        open={confirmDeleteId != null}
        pending={deleteMut.isPending}
        onCancel={() => {
          if (!deleteMut.isPending) setConfirmDeleteId(null);
        }}
        onConfirm={() => {
          if (confirmDeleteId != null) deleteMut.mutate(confirmDeleteId);
        }}
      />
      {deleteMut.isError ? (
        <p className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-red-600 px-3 py-2 text-xs text-white" role="alert">
          Could not delete conversation.
        </p>
      ) : null}
    </PatientLayout>
  );
}
