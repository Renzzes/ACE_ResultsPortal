import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, MessageSquare, MoreVertical, Plus, Search, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ConversationActionSheet, DeleteConversationDialog } from "@/components/comms/delete-conversation-dialog";
import { useAuth } from "@/lib/auth";
import { ACCESS_TOKEN_KEY } from "@/lib/workflow-stability";
import {
  closeMessageThread,
  createMessageThread,
  deleteMessageThread,
  fetchMessageRecipients,
  fetchMessageThread,
  fetchMessageThreads,
  sendMessage,
  type MessageRecipient,
  type MessageThreadSummary,
} from "@/lib/comms-api";
import { enterSendsMessage, messageBodyToSend } from "@/lib/message-composer";
import { useMessageLive } from "@/lib/message-live";
import { usePersistedThreadId } from "@/lib/thread-selection";
import { useRowLongPress } from "@/lib/use-row-long-press";
import { formatRelativeTime } from "@/lib/notification-utils";

type Variant = "staff" | "doctor" | "admin";

export function MessagesWorkspace({ variant }: { variant: Variant }) {
  const { auth } = useAuth();
  const myId = Number(auth.user?.id ?? 0);
  const queryClient = useQueryClient();
  const { activeId, setActiveId } = usePersistedThreadId();
  const [mobileChat, setMobileChat] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    const id = Number(params.get("threadId"));
    return Number.isInteger(id) && id > 0;
  });
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [actionThreadId, setActionThreadId] = useState<number | null>(null);
  const sendingRef = useRef(false);
  const { bind: bindLongPress, consumeSuppressedClick } = useRowLongPress((id) => {
    setActionThreadId(id);
  });
  const liveStatus = useMessageLive({
    enabled: Boolean(auth.token),
    scope: "staff",
    activeThreadId: activeId,
    getToken: () => sessionStorage.getItem(ACCESS_TOKEN_KEY),
    onConversationDeleted: (id) => {
      if (activeId === id) {
        setActiveId(null);
        setMobileChat(false);
      }
      if (confirmDeleteId === id) setConfirmDeleteId(null);
      if (actionThreadId === id) setActionThreadId(null);
    },
  });
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState("");
  const [peopleOpen, setPeopleOpen] = useState(false);
  const [recipientSearch, setRecipientSearch] = useState("");
  const [debouncedRecipientSearch, setDebouncedRecipientSearch] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedRecipientSearch(recipientSearch.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [recipientSearch]);

  const threadsQuery = useQuery({
    queryKey: ["message-threads"],
    queryFn: () => fetchMessageThreads({ page: 1, limit: 50 }),
    refetchOnWindowFocus: true,
  });

  const recipientQueryText = debouncedRecipientSearch;
  const recipientsQuery = useQuery({
    queryKey: ["message-recipients", recipientQueryText],
    queryFn: () => fetchMessageRecipients(recipientQueryText),
    enabled: peopleOpen && recipientQueryText.length >= 2,
  });

  const threadQuery = useQuery({
    queryKey: ["message-thread", activeId],
    queryFn: () => fetchMessageThread(activeId!),
    enabled: activeId != null,
  });

  useEffect(() => {
    if (activeId == null || !threadQuery.isError) return;
    setActiveId(null);
    setMobileChat(false);
  }, [activeId, threadQuery.isError, setActiveId]);

  const sendMut = useMutation({
    mutationFn: (body: string) => sendMessage(activeId!, body),
    onSuccess: () => {
      setDraft("");
      void queryClient.invalidateQueries({ queryKey: ["message-thread", activeId] });
      void queryClient.invalidateQueries({ queryKey: ["message-threads"] });
      void queryClient.invalidateQueries({ queryKey: ["notifications-unread"] });
    },
  });

  const openConversationMut = useMutation({
    mutationFn: (recipientUserId: number) => createMessageThread({ recipientUserId }),
    onSuccess: (created) => {
      setPeopleOpen(false);
      setRecipientSearch("");
      setDebouncedRecipientSearch("");
      void queryClient.invalidateQueries({ queryKey: ["message-threads"] });
      setActiveId(created.id);
      setMobileChat(true);
    },
  });

  const closeMut = useMutation({
    mutationFn: () => closeMessageThread(activeId!),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["message-thread", activeId] });
      void queryClient.invalidateQueries({ queryKey: ["message-threads"] });
    },
  });

  const deleteMut = useMutation({
    mutationFn: (threadId: number) => deleteMessageThread(threadId),
    onSuccess: (_result, threadId) => {
      if (activeId === threadId) {
        setActiveId(null);
        setMobileChat(false);
      }
      setConfirmDeleteId(null);
      setActionThreadId(null);
      queryClient.removeQueries({ queryKey: ["message-thread", threadId] });
      void queryClient.invalidateQueries({ queryKey: ["message-threads"] });
    },
  });

  const submitDraft = () => {
    const textBody = messageBodyToSend(draft, sendMut.isPending || sendingRef.current);
    if (!textBody || activeId == null) return;
    sendingRef.current = true;
    sendMut.mutate(textBody, {
      onSettled: () => {
        sendingRef.current = false;
      },
    });
  };

  const threads = threadsQuery.data?.data ?? [];
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return threads;
    return threads.filter((t) =>
      `${t.subject} ${t.patientName ?? ""} ${t.lastMessagePreview ?? ""} ${t.participants.map((p) => p.name).join(" ")}`
        .toLowerCase()
        .includes(q),
    );
  }, [query, threads]);

  const active: MessageThreadSummary | undefined = threads.find((t) => t.id === activeId);
  const detail = threadQuery.data;

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [detail?.messages.data.length, activeId]);

  const card =
    variant === "admin"
      ? "ad-card rounded-xl overflow-hidden flex lg:h-full min-h-[70vh] lg:min-h-0"
      : variant === "doctor"
        ? "doc-card rounded-2xl overflow-hidden flex lg:h-full min-h-[70vh] lg:min-h-0"
        : "st-card rounded-2xl overflow-hidden flex lg:h-full min-h-[70vh] lg:min-h-0";

  const border =
    variant === "admin"
      ? "border-[#E3E8E4]"
      : variant === "doctor"
        ? "border-[hsl(var(--doc-border))]"
        : "border-[hsl(var(--st-border))]";

  const text =
    variant === "admin"
      ? "text-[#17251E]"
      : variant === "doctor"
        ? "text-[hsl(var(--doc-text))]"
        : "text-[hsl(var(--st-text))]";

  const muted =
    variant === "admin" ? "text-[#66756C]" : variant === "doctor" ? "doc-muted" : "st-muted";

  const accent =
    variant === "admin"
      ? "bg-[#1F6B45] text-white hover:bg-[#185536]"
      : variant === "doctor"
        ? "bg-[hsl(var(--doc-green))] text-white"
        : "bg-[hsl(var(--st-green))] text-white";

  const openThread = (id: number) => {
    setActiveId(id);
    setMobileChat(true);
  };

  const otherParticipants = (detail?.participants ?? active?.participants ?? []).filter(
    (p) => p.id !== myId,
  );

  return (
    <div className={card}>
      <aside
        className={`${mobileChat ? "hidden" : "flex"} lg:flex w-full lg:w-[320px] xl:w-[360px] flex-col border-r ${border} min-h-0`}
      >
        <div className={`px-4 py-3 border-b ${border} flex-shrink-0 space-y-2`}>
          <div className="flex items-center justify-between gap-2">
            <p className={`font-semibold ${text}`}>
              Messages
              {liveStatus !== "connected" ? (
                <span className={`ml-2 text-[11px] font-medium ${muted}`}>
                  {liveStatus === "reconnecting" ? "Reconnecting..." : "Connecting"}
                </span>
              ) : (
                <span className={`ml-2 text-[11px] font-medium ${muted}`}>Connected</span>
              )}
            </p>
            <Button
              type="button"
              size="sm"
              className={accent}
              onClick={() => {
                setPeopleOpen(true);
                setMobileChat(false);
                setRecipientSearch("");
              }}
            >
              <Plus className="h-4 w-4 mr-1" />
              New
            </Button>
          </div>
          {peopleOpen ? (
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 ${muted}`} />
                <Input
                  className="pl-9 h-9"
                  placeholder="Search people..."
                  value={recipientSearch}
                  onChange={(e) => setRecipientSearch(e.target.value)}
                  autoFocus
                />
              </div>
              <button
                type="button"
                className={`text-xs font-semibold ${muted}`}
                onClick={() => {
                  setPeopleOpen(false);
                  setRecipientSearch("");
                }}
              >
                Cancel
              </button>
            </div>
          ) : (
            <div className="relative">
              <Search className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 ${muted}`} />
              <Input
                className="pl-9 h-9"
                placeholder="Search conversations"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
          )}
        </div>

        <ul className="flex-1 overflow-y-auto min-h-0">
          {peopleOpen ? (
            <PeopleResults
              search={recipientQueryText}
              loading={recipientsQuery.isFetching}
              error={recipientsQuery.isError}
              recipients={recipientsQuery.data ?? []}
              pendingId={openConversationMut.isPending ? openConversationMut.variables : null}
              errorText={openConversationMut.isError ? "Could not open conversation." : null}
              text={text}
              muted={muted}
              border={border}
              onSelect={(id) => {
                if (openConversationMut.isPending) return;
                openConversationMut.mutate(id);
              }}
            />
          ) : null}
          {!peopleOpen && threadsQuery.isLoading ? (
            <li className={`px-4 py-8 text-sm ${muted}`}>Loading conversations…</li>
          ) : null}
          {!peopleOpen && threadsQuery.isError ? (
            <li className={`px-4 py-8 text-sm ${muted}`}>
              Unable to load messages. If tables are missing, run migration 007 in SSMS.
            </li>
          ) : null}
          {!peopleOpen && !threadsQuery.isLoading && !threadsQuery.isError && filtered.length === 0 ? (
            <li className={`px-4 py-10 text-center text-sm ${muted}`}>No conversations yet.</li>
          ) : null}
          {!peopleOpen
            ? filtered.map((thread) => {
            const others = thread.participants.filter((p) => p.id !== myId);
            const label = others.map((p) => p.name).join(", ") || "Conversation";
            return (
              <li
                key={thread.id}
                className={`flex items-stretch border-b ${border} ${activeId === thread.id ? "bg-black/5" : ""}`}
              >
                <button
                  type="button"
                  onClick={() => {
                    if (consumeSuppressedClick()) return;
                    openThread(thread.id);
                  }}
                  className="min-w-0 flex-1 text-left px-4 py-3 hover:opacity-90"
                  {...bindLongPress(thread.id)}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className={`text-sm font-semibold ${text} line-clamp-1`}>{thread.subject}</p>
                    <span className={`text-[11px] ${muted} shrink-0`}>
                      {thread.lastMessageAt ? formatRelativeTime(thread.lastMessageAt) : ""}
                    </span>
                  </div>
                  <p className={`text-xs ${muted} mt-0.5 line-clamp-1`}>{label}</p>
                  <p className={`text-xs ${muted} mt-0.5 line-clamp-1`}>
                    {thread.lastMessagePreview ?? "No messages yet"}
                  </p>
                  {thread.unreadCount > 0 ? (
                    <span className="mt-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[#1F6B45] px-1.5 text-[10px] font-bold text-white">
                      {thread.unreadCount}
                    </span>
                  ) : null}
                </button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className={`shrink-0 self-center rounded-lg p-2 ${muted}`}
                      aria-label={`Conversation actions for ${thread.subject}`}
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
          })
            : null}
        </ul>
      </aside>

      <section
        className={`${mobileChat ? "flex" : "hidden"} lg:flex flex-1 flex-col min-w-0 min-h-0`}
      >
        {!activeId ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
            <MessageSquare className={`h-8 w-8 ${muted}`} />
            <p className={`text-sm font-medium ${text}`}>Select a conversation</p>
            <p className={`text-xs ${muted}`}>Or choose New to search for a person.</p>
          </div>
        ) : threadQuery.isLoading ? (
          <div className={`flex flex-1 items-center justify-center text-sm ${muted}`}>Loading…</div>
        ) : threadQuery.isError || !detail ? (
          <div className={`flex flex-1 items-center justify-center text-sm ${muted}`}>
            Unable to open conversation.
          </div>
        ) : (
          <>
            <div className={`flex items-center gap-3 border-b ${border} px-4 py-3 flex-shrink-0`}>
              <button
                type="button"
                className={`lg:hidden rounded-lg p-1 ${muted}`}
                onClick={() => setMobileChat(false)}
                aria-label="Back"
              >
                <ArrowLeft className="h-5 w-5" />
              </button>
              <div className="min-w-0 flex-1">
                <p className={`font-semibold ${text} truncate`}>{detail.subject}</p>
                <p className={`text-xs ${muted} truncate`}>
                  {otherParticipants.map((p) => p.name).join(", ")}
                  {detail.patientName ? ` · Patient: ${detail.patientName}` : ""}
                  {detail.isClosed ? " · Closed" : ""}
                </p>
              </div>
              {!detail.isClosed ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => closeMut.mutate()}
                  disabled={closeMut.isPending}
                >
                  Close
                </Button>
              ) : null}
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3 min-h-0">
              {detail.messages.data.map((m) => {
                const mine = m.senderUserId === myId;
                return (
                  <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                    <div
                      className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${
                        mine
                          ? "bg-[#1F6B45] text-white"
                          : variant === "admin"
                            ? "bg-[#F3F6F4] text-[#17251E]"
                            : "bg-black/5"
                      }`}
                    >
                      {!mine ? (
                        <p className={`text-[11px] mb-0.5 opacity-80`}>{m.senderName}</p>
                      ) : null}
                      <p className="whitespace-pre-wrap break-words">{m.body}</p>
                      <p className={`text-[10px] mt-1 opacity-70`}>
                        {formatRelativeTime(m.createdAt)}
                      </p>
                    </div>
                  </div>
                );
              })}
              <div ref={endRef} />
            </div>

            <div className={`border-t ${border} p-3 flex-shrink-0`}>
              {detail.isClosed ? (
                <p className={`text-sm ${muted} text-center py-2`}>This conversation is closed.</p>
              ) : (
                <form
                  className="flex gap-2 items-end"
                  onSubmit={(e) => {
                    e.preventDefault();
                    submitDraft();
                  }}
                >
                  <Textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(event) => {
                      if (!enterSendsMessage(event.nativeEvent)) return;
                      event.preventDefault();
                      submitDraft();
                    }}
                    placeholder="Type a message…"
                    className="min-h-[44px] max-h-32 resize-none"
                    rows={2}
                  />
                  <Button type="submit" className={accent} disabled={!draft.trim() || sendMut.isPending}>
                    <Send className="h-4 w-4" />
                  </Button>
                </form>
              )}
              {sendMut.isError ? (
                <p className="mt-2 text-xs text-red-600">Could not send message.</p>
              ) : null}
            </div>
          </>
        )}
      </section>

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
        <p className="border-t border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700" role="alert">
          Could not delete conversation.
        </p>
      ) : null}
    </div>
  );
}

function PeopleResults(props: {
  search: string;
  loading: boolean;
  error: boolean;
  recipients: MessageRecipient[];
  pendingId: number | undefined | null;
  errorText: string | null;
  text: string;
  muted: string;
  border: string;
  onSelect: (id: number) => void;
}) {
  if (props.search.length < 2) {
    return (
      <li className={`px-4 py-8 text-sm ${props.muted}`}>
        Search for a person by name, username, or department.
      </li>
    );
  }
  if (props.loading) {
    return <li className={`px-4 py-8 text-sm ${props.muted}`}>Searching…</li>;
  }
  if (props.error) {
    return <li className="px-4 py-8 text-sm text-red-600">Unable to search people. Try again.</li>;
  }
  if (props.recipients.length === 0) {
    return <li className={`px-4 py-8 text-sm ${props.muted}`}>No matching people.</li>;
  }
  return (
    <>
      <li className={`px-4 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wide ${props.muted}`}>
        Search results
      </li>
      {props.recipients.map((recipient) => (
        <li key={recipient.id} className={`border-b ${props.border}`}>
          <button
            type="button"
            className="flex w-full flex-col px-4 py-3 text-left hover:bg-black/5 disabled:opacity-60"
            disabled={props.pendingId != null}
            onClick={() => props.onSelect(recipient.id)}
          >
            <span className={`text-sm font-semibold ${props.text}`}>{recipient.name}</span>
            <span className={`text-xs ${props.muted}`}>
              {recipient.department || recipient.role}
            </span>
          </button>
        </li>
      ))}
      {props.errorText ? <li className="px-4 py-2 text-xs text-red-600">{props.errorText}</li> : null}
    </>
  );
}
