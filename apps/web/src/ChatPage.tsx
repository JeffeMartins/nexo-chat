import { useState, useEffect, useRef } from "react";
import {
  MessageCircle,
  Plus,
  Search,
  LogOut,
  Users,
  Send,
  ArrowLeft,
  Info,
  X,
  Check,
  RefreshCw,
  UserPlus,
  Trash2,
  WifiOff,
} from "lucide-react";
import type { SessionView, Conversation } from "@nexo/contracts";
import { api } from "./api";
import { useChat } from "./useChat";
import NewConversation from "./NewConversation";
const time = (value: string) =>
  new Date(value).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
function title(c: Conversation, userId: string) {
  return c.kind === "GROUP"
    ? c.title || "Grupo"
    : c.members.find((u) => u.id !== userId)?.displayName || "Conversa";
}
function Avatar({ name, group = false }: { name: string; group?: boolean }) {
  return (
    <span className={`avatar ${group ? "group-avatar" : ""}`}>
      {group ? <Users size={21} /> : name.slice(0, 1).toUpperCase()}
    </span>
  );
}
export default function ChatPage({
  session,
  onLogout,
}: {
  session: SessionView;
  onLogout: () => void;
}) {
  const chat = useChat(session);
  const [filter, setFilter] = useState("");
  const [dialog, setDialog] = useState<"NEW" | "ADD" | null>(null);
  const [details, setDetails] = useState(false);
  const [draft, setDraft] = useState("");
  const [logoutBusy, setLogoutBusy] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  const typingAt = useRef(0);
  const lastMessageId = chat.messages.at(-1)?.id;
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end", behavior: "instant" });
  }, [lastMessageId, chat.pending.length, chat.activeId]);
  async function logout() {
    setLogoutBusy(true);
    try {
      await api("/auth/logout", { method: "POST", csrf: session.csrfToken });
      onLogout();
    } catch (e) {
      chat.setError(e instanceof Error ? e.message : "Não foi possível sair.");
    } finally {
      setLogoutBusy(false);
    }
  }
  async function remove(id: string, name: string) {
    if (!chat.active || !window.confirm("Remover " + name + " do grupo?"))
      return;
    setActionBusy(true);
    try {
      await api("/conversations/" + chat.active.id + "/members/" + id, {
        method: "DELETE",
        csrf: session.csrfToken,
      });
      await chat.refresh();
    } catch (e) {
      chat.setError(
        e instanceof Error ? e.message : "Não foi possível remover.",
      );
    } finally {
      setActionBusy(false);
    }
  }
  const active = chat.active;
  const peer =
    active?.kind === "DIRECT"
      ? active.members.find((m) => m.id !== session.user.id)
      : null;
  const peerOnline = peer ? chat.presence[peer.id] : null;
  const status =
    active?.kind === "GROUP"
      ? active.members.length + " participantes"
      : peerOnline === true
        ? "Online agora"
        : peerOnline === false
          ? "Offline"
          : "Verificando presença…";
  const send = (event: React.FormEvent) => {
    event.preventDefault();
    const body = draft.trim();
    if (!body || !chat.connected) return;
    void chat.send(body);
    setDraft("");
  };
  return (
    <main className={`workspace ${active ? "has-active" : ""}`}>
      <aside className="sidebar">
        <div className="sidebar-brand">
          <a href="/" className="wordmark">
            <span className="brand-icon">
              <MessageCircle size={22} />
            </span>
            nexo<span className="brand-dot">.</span>
          </a>
          <span className="version-pill">SEU ESPAÇO</span>
        </div>
        <div className="sidebar-heading">
          <div>
            <span className="eyebrow">BOM TER VOCÊ AQUI</span>
            <h1>Conversas</h1>
          </div>
          <button
            className="new-button"
            aria-label="Nova conversa"
            onClick={() => setDialog("NEW")}
          >
            <Plus size={21} />
          </button>
        </div>
        <label className="search-field conversation-search">
          <Search size={16} />
          <input
            aria-label="Buscar conversas"
            placeholder="Buscar uma conversa"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </label>
        <div className="sidebar-list-label">
          SUAS CONEXÕES{" "}
          <span>{chat.conversations.length.toString().padStart(2, "0")}</span>
        </div>
        <nav className="conversation-list" aria-label="Conversas">
          {chat.conversations
            .filter((c) =>
              title(c, session.user.id)
                .toLowerCase()
                .includes(filter.toLowerCase()),
            )
            .map((c) => {
              const name = title(c, session.user.id);
              return (
                <button
                  key={c.id}
                  className={`conversation-item ${c.id === chat.activeId ? "active" : ""}`}
                  onClick={() => {
                    chat.setActiveId(c.id);
                    setDetails(false);
                    setDraft("");
                  }}
                >
                  <Avatar name={name} group={c.kind === "GROUP"} />
                  <span className="conversation-copy">
                    <span>
                      <strong>{name}</strong>
                      {c.lastMessage && (
                        <time>{time(c.lastMessage.createdAt)}</time>
                      )}
                    </span>
                    <span>
                      <small>
                        {c.lastMessage
                          ? (c.lastMessage.sender.id === session.user.id
                              ? "Você: "
                              : "") + c.lastMessage.body
                          : c.kind === "GROUP"
                            ? "A turma já está aqui."
                            : "Diga um olá 👋"}
                      </small>
                      {c.unreadCount > 0 && (
                        <b className="unread-badge">
                          {c.unreadCount > 99 ? "99+" : c.unreadCount}
                        </b>
                      )}
                    </span>
                  </span>
                </button>
              );
            })}
          {!chat.conversations.length && (
            <div className="sidebar-empty">
              <MessageCircle size={28} />
              <strong>
                Sua próxima conversa
                <br />
                começa aqui.
              </strong>
              <p>Toque no + e encontre alguém.</p>
            </div>
          )}
        </nav>
        <div className="sidebar-tip">
          <span>✳</span>
          <p>
            Uma mensagem pode
            <br />
            mudar o dia de alguém.
          </p>
        </div>
        <div className="account">
          <Avatar name={session.user.displayName} />
          <div>
            <strong>{session.user.displayName}</strong>
            <small>@{session.user.handle}</small>
          </div>
          <button
            className="icon-button"
            aria-label="Sair da conta"
            disabled={logoutBusy}
            onClick={() => void logout()}
          >
            <LogOut size={17} />
          </button>
        </div>
      </aside>
      <section className="chat-panel" aria-label="Área de conversa">
        {!chat.connected && (
          <div className="connection-banner" role="status">
            <WifiOff size={14} />
            Conectando… Suas mensagens salvas continuam aqui.
          </div>
        )}
        {chat.error && (
          <div className="error-banner" role="alert">
            <span>{chat.error}</span>
            <button
              className="icon-button"
              aria-label="Fechar aviso"
              onClick={() => chat.setError("")}
            >
              <X size={16} />
            </button>
          </div>
        )}
        {active ? (
          <>
            <header className="chat-header">
              <button
                className="icon-button mobile-back"
                aria-label="Voltar às conversas"
                onClick={() => chat.setActiveId(null)}
              >
                <ArrowLeft size={21} />
              </button>
              <Avatar
                name={title(active, session.user.id)}
                group={active.kind === "GROUP"}
              />
              <div>
                <h2>{title(active, session.user.id)}</h2>
                <p>
                  <i
                    className={`status-dot ${peerOnline || active.kind === "GROUP" ? "" : "offline"}`}
                  />
                  {status}
                </p>
              </div>
              <button
                className={`icon-button details-toggle ${details ? "selected" : ""}`}
                aria-label="Detalhes da conversa"
                onClick={() => setDetails((v) => !v)}
              >
                <Info size={21} />
              </button>
            </header>
            <div
              className="message-area"
              role="log"
              aria-label="Mensagens"
              aria-live="polite"
            >
              <div className="chat-start">
                <span className="pill">O COMEÇO DE UMA BOA CONVERSA</span>
                <p>
                  {active.kind === "GROUP"
                    ? "Aproxime a turma. O espaço é de vocês."
                    : "Pode chegar. O espaço é de vocês."}
                </p>
              </div>
              {chat.hasOlder && (
                <button
                  className="older-button"
                  onClick={() => void chat.loadOlder()}
                >
                  <RefreshCw size={13} />
                  Mensagens anteriores
                </button>
              )}
              {chat.messages.map((m, index) => {
                const own = m.sender.id === session.user.id;
                const previous = chat.messages[index - 1];
                const date = new Date(m.createdAt).toLocaleDateString("pt-BR");
                const showDate =
                  !previous ||
                  new Date(previous.createdAt).toLocaleDateString("pt-BR") !==
                    date;
                return (
                  <div key={m.id}>
                    {showDate && (
                      <div className="date-divider">
                        <span>{date}</span>
                      </div>
                    )}
                    <article
                      className={`message-row ${own ? "own" : ""}`}
                      data-testid="message"
                    >
                      {!own && active.kind === "GROUP" && (
                        <span className="message-avatar">
                          {m.sender.displayName.slice(0, 1)}
                        </span>
                      )}
                      <div className="message-bubble">
                        {!own && active.kind === "GROUP" && (
                          <strong className="sender-name">
                            {m.sender.displayName}
                          </strong>
                        )}
                        <p>{m.body}</p>
                        <span className="message-time">
                          <time dateTime={m.createdAt}>
                            {time(m.createdAt)}
                          </time>
                          {own && <Check size={13} aria-label="Salva" />}
                        </span>
                      </div>
                    </article>
                  </div>
                );
              })}
              {chat.pending.map((p) => (
                <article key={p.clientId} className="message-row own">
                  <div
                    className={`message-bubble pending ${p.error ? "failed" : ""}`}
                  >
                    <p>{p.body}</p>
                    {p.error ? (
                      <button onClick={() => void chat.send(p.body, p)}>
                        Tentar novamente
                      </button>
                    ) : (
                      <span className="message-time">Enviando…</span>
                    )}
                  </div>
                </article>
              ))}
              {chat.typing && (
                <div className="typing-indicator">
                  {chat.typing.user.displayName} está digitando<span>…</span>
                </div>
              )}
              <div ref={bottom} />
            </div>
            <form className="composer" onSubmit={send}>
              <div className="composer-field">
                <textarea
                  aria-label="Mensagem"
                  placeholder={
                    chat.connected
                      ? "Escreva uma mensagem…"
                      : "Aguardando conexão…"
                  }
                  value={draft}
                  rows={1}
                  maxLength={4000}
                  onChange={(e) => {
                    setDraft(e.target.value);
                    if (Date.now() - typingAt.current > 2200) {
                      typingAt.current = Date.now();
                      chat.startTyping();
                    }
                  }}
                  onKeyDown={(e) => {
                    if (
                      e.key === "Enter" &&
                      !e.shiftKey &&
                      !e.nativeEvent.isComposing
                    ) {
                      e.preventDefault();
                      send(e);
                    }
                  }}
                />
                <button
                  type="submit"
                  className="send-button"
                  aria-label="Enviar mensagem"
                  disabled={!draft.trim() || !chat.connected}
                >
                  <Send size={20} />
                </button>
              </div>
              <small>
                Enter para enviar · Shift + Enter para uma nova linha
                <span>Uma conversa de cada vez.</span>
              </small>
            </form>
          </>
        ) : (
          <div className="welcome">
            <span className="welcome-orbit">
              <MessageCircle size={49} strokeWidth={1.5} />
              <i>✳</i>
            </span>
            <span className="eyebrow">
              AS MELHORES CONEXÕES COMEÇAM COM UM OLÁ
            </span>
            <h2>
              Perto, mesmo
              <br />
              de longe.
            </h2>
            <p>
              Escolha uma conversa ou encontre alguém novo.
              <br />O próximo bom papo pode começar agora.
            </p>
            <button className="primary" onClick={() => setDialog("NEW")}>
              <Plus size={18} />
              Começar uma conversa
            </button>
            <div className="welcome-foot">
              <span className="status-dot" />
              Mensagens em tempo real. Conexões de verdade.
            </div>
          </div>
        )}
      </section>
      {details && active && (
        <aside className="details-panel">
          <div className="details-heading">
            <h2>Sobre a conversa</h2>
            <button
              className="icon-button"
              aria-label="Fechar detalhes"
              onClick={() => setDetails(false)}
            >
              <X size={19} />
            </button>
          </div>
          <div className="details-identity">
            <Avatar
              name={title(active, session.user.id)}
              group={active.kind === "GROUP"}
            />
            <h3>{title(active, session.user.id)}</h3>
            <p>
              {active.kind === "GROUP"
                ? "Um espaço para a turma."
                : "Uma conexão, muitas histórias."}
            </p>
          </div>
          <div className="participants-heading">
            <h3>
              Participantes <span>{active.members.length}</span>
            </h3>
            {active.kind === "GROUP" &&
              active.createdBy === session.user.id && (
                <button
                  className="icon-button"
                  aria-label="Adicionar participantes"
                  onClick={() => setDialog("ADD")}
                >
                  <UserPlus size={17} />
                </button>
              )}
          </div>
          <div className="participants">
            {active.members.map((m) => (
              <div key={m.id} className="participant">
                <Avatar name={m.displayName} />
                <span>
                  <strong>
                    {m.displayName}
                    {m.id === session.user.id ? " (você)" : ""}
                  </strong>
                  <small>
                    {active.createdBy === m.id && active.kind === "GROUP"
                      ? "Criou o grupo"
                      : "@" + m.handle}
                  </small>
                </span>
                {active.kind === "GROUP" &&
                  active.createdBy === session.user.id &&
                  m.id !== session.user.id && (
                    <button
                      className="icon-button remove-member"
                      aria-label={"Remover " + m.displayName}
                      disabled={actionBusy}
                      onClick={() => void remove(m.id, m.displayName)}
                    >
                      <Trash2 size={15} />
                    </button>
                  )}
              </div>
            ))}
          </div>
          <div className="details-note">
            <MessageCircle size={20} />
            <p>
              {active.kind === "GROUP"
                ? "Participantes adicionados podem ler o histórico do grupo."
                : "Só os participantes podem acessar esta conversa."}
            </p>
          </div>
        </aside>
      )}
      {dialog && (
        <NewConversation
          session={session}
          group={dialog === "ADD" && active ? active : undefined}
          onClose={() => setDialog(null)}
          onCreated={(c) => {
            setDialog(null);
            void chat.refresh();
            if (c) {
              chat.setActiveId(c.id);
              setDraft("");
            }
          }}
        />
      )}
    </main>
  );
}
