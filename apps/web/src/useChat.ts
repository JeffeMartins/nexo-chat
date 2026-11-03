import { useState, useEffect, useRef, useCallback } from "react";
import { io, type Socket } from "socket.io-client";
import type {
  SessionView,
  Conversation,
  Message,
  Ack,
  User,
} from "@nexo/contracts";
import { api, ApiError } from "./api";
import { mergeMessages } from "./messages";
export type Pending = {
  clientId: string;
  conversationId: string;
  body: string;
  error: string | null;
};
export function useChat(session: SessionView) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Record<string, Message[]>>({});
  const [hasOlder, setHasOlder] = useState<Record<string, boolean>>({});
  const [presence, setPresence] = useState<Record<string, boolean | null>>({});
  const [connected, setConnected] = useState(false);
  const [syncEpoch, setSyncEpoch] = useState(0);
  const [pending, setPending] = useState<Pending[]>([]);
  const [typing, setTyping] = useState<{
    conversationId: string;
    user: User;
    until: number;
  } | null>(null);
  const [error, setError] = useState("");
  const socketRef = useRef<Socket | null>(null);
  const cursors = useRef<Record<string, string>>({});
  const syncing = useRef(new Set<string>());
  const refresh = useCallback(async () => {
    try {
      setConversations(
        (await api<{ items: Conversation[] }>("/conversations")).items,
      );
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 401))
        setError("Não foi possível atualizar as conversas.");
    }
  }, []);
  const receive = useCallback((items: Message[]) => {
    if (!items.length) return;
    const id = items[0].conversationId;
    setMessages((prev) => ({
      ...prev,
      [id]: mergeMessages(prev[id] || [], items),
    }));
    const ids = new Set(items.map((m) => m.clientId));
    setPending((prev) => prev.filter((p) => !ids.has(p.clientId)));
  }, []);
  useEffect(() => {
    const socket = io({
      transports: ["websocket"],
      auth: { csrfToken: session.csrfToken },
      reconnectionDelay: 500,
      reconnectionDelayMax: 5000,
    });
    socketRef.current = socket;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    const scheduleRefresh = () => {
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => void refresh(), 150);
    };
    socket.on("connect", () => {
      setConnected(true);
      setError("");
      setSyncEpoch((n) => n + 1);
      void refresh();
    });
    socket.on("disconnect", (reason) => {
      setConnected(false);
      if (reason === "io server disconnect")
        window.dispatchEvent(new Event("auth:expired"));
    });
    socket.on("connect_error", () => {
      setConnected(false);
      void api("/auth/me").catch(() => {});
    });
    socket.on("message:new", (message: Message) => {
      receive([message]);
      scheduleRefresh();
    });
    socket.on("conversation:changed", scheduleRefresh);
    socket.on(
      "presence:changed",
      ({ userId, online }: { userId: string; online: boolean }) =>
        setPresence((prev) => ({ ...prev, [userId]: online })),
    );
    socket.on(
      "typing:changed",
      (data: { conversationId: string; user: User }) =>
        setTyping({ ...data, until: Date.now() + 3500 }),
    );
    const poll = setInterval(() => void refresh(), 15000);
    return () => {
      clearInterval(poll);
      clearTimeout(refreshTimer);
      socket.disconnect();
      socketRef.current = null;
    };
  }, [session.csrfToken, refresh, receive]);
  useEffect(() => {
    const t = setInterval(
      () =>
        setTyping((prev) => (prev && prev.until < Date.now() ? null : prev)),
      1000,
    );
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (!activeId) return;
    let cancelled = false;
    const sync = async () => {
      if (syncing.current.has(activeId)) return;
      syncing.current.add(activeId);
      try {
        for (let n = 0; n < 10 && !cancelled; n++) {
          const cursor = cursors.current[activeId];
          const query = cursor
            ? "?after=" + cursor + "&limit=100"
            : "?limit=30";
          const result = await api<{ items: Message[]; hasMore: boolean }>(
            "/conversations/" + activeId + "/messages" + query,
          );
          if (cancelled) return;
          receive(result.items);
          if (!cursor)
            setHasOlder((prev) => ({ ...prev, [activeId]: result.hasMore }));
          const last = result.items.at(-1);
          if (last) cursors.current[activeId] = last.sequence;
          if (!cursor || !result.hasMore || !last) break;
        }
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) {
          setActiveId(null);
          void refresh();
        } else if (!cancelled)
          setError("Histórico indisponível. Tentaremos sincronizar novamente.");
      } finally {
        syncing.current.delete(activeId);
      }
    };
    void sync();
    const interval = setInterval(() => void sync(), 6000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [activeId, syncEpoch, receive, refresh]);
  const active = conversations.find((c) => c.id === activeId) || null;
  const memberKey =
    active?.members
      .map((m) => m.id)
      .sort()
      .join(",") || "";
  useEffect(() => {
    if (!memberKey) return;
    let cancelled = false;
    const snapshot = async () => {
      try {
        const result = await api<{
          items: { userId: string; online: boolean | null }[];
        }>("/presence?ids=" + memberKey);
        if (!cancelled)
          setPresence((prev) => ({
            ...prev,
            ...Object.fromEntries(
              result.items.map((p) => [p.userId, p.online]),
            ),
          }));
      } catch {
        if (!cancelled)
          setPresence((prev) => ({
            ...prev,
            ...Object.fromEntries(memberKey.split(",").map((id) => [id, null])),
          }));
      }
    };
    void snapshot();
    const t = setInterval(() => void snapshot(), 20000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [memberKey, syncEpoch]);
  const current = activeId ? messages[activeId] || [] : [];
  const latest = current.at(-1)?.sequence;
  useEffect(() => {
    if (!activeId || !latest) return;
    const mark = () => {
      if (document.visibilityState === "visible")
        void api("/conversations/" + activeId + "/read", {
          method: "POST",
          csrf: session.csrfToken,
          body: { sequence: latest },
        })
          .then(() =>
            setConversations((prev) =>
              prev.map((c) =>
                c.id === activeId ? { ...c, unreadCount: 0 } : c,
              ),
            ),
          )
          .catch(() => {});
    };
    mark();
    document.addEventListener("visibilitychange", mark);
    return () => document.removeEventListener("visibilitychange", mark);
  }, [activeId, latest, session.csrfToken]);
  const send = async (body: string, retry?: Pending) => {
    if (!activeId || !socketRef.current?.connected) {
      setError("Aguarde a reconexão para enviar.");
      return;
    }
    const item: Pending = retry
      ? { ...retry, error: null }
      : {
          clientId: crypto.randomUUID(),
          conversationId: activeId,
          body,
          error: null,
        };
    setPending((prev) => [
      ...prev.filter((p) => p.clientId !== item.clientId),
      item,
    ]);
    socketRef.current.timeout(8000).emit(
      "message:send",
      {
        conversationId: item.conversationId,
        clientId: item.clientId,
        body: item.body,
      },
      (err: Error | null, result: Ack<Message>) => {
        if (err || !result?.ok) {
          const reason = err
            ? "Não recebemos a confirmação. Você pode tentar novamente."
            : result && !result.ok
              ? result.error.message
              : "Falha ao enviar.";
          setPending((prev) =>
            prev.map((p) =>
              p.clientId === item.clientId ? { ...p, error: reason } : p,
            ),
          );
          return;
        }
        receive([result.data]);
        void refresh();
      },
    );
  };
  const loadOlder = async () => {
    if (!activeId || !current.length) return;
    try {
      const result = await api<{ items: Message[]; hasMore: boolean }>(
        "/conversations/" +
          activeId +
          "/messages?before=" +
          current[0].sequence +
          "&limit=30",
      );
      receive(result.items);
      setHasOlder((prev) => ({ ...prev, [activeId]: result.hasMore }));
    } catch {
      setError("Não foi possível carregar mensagens anteriores.");
    }
  };
  const startTyping = () => {
    if (activeId && socketRef.current?.connected)
      socketRef.current.emit("typing:start", { conversationId: activeId });
  };
  return {
    conversations,
    activeId,
    setActiveId,
    active,
    messages: current,
    hasOlder: activeId ? hasOlder[activeId] && current.length < 300 : false,
    loadOlder,
    presence,
    connected,
    pending: pending.filter((p) => p.conversationId === activeId),
    typing: typing?.conversationId === activeId ? typing : null,
    error,
    setError,
    send,
    startTyping,
    refresh,
  };
}
