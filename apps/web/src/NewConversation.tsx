import { useState, useEffect, useRef } from "react";
import {
  X,
  Search,
  Check,
  Users,
  MessageCircle,
  ArrowRight,
} from "lucide-react";
import type {
  DirectoryUser,
  Conversation,
  SessionView,
} from "@conversa/contracts";
import { api } from "./api";
export default function NewConversation({
  session,
  onClose,
  onCreated,
  group,
}: {
  session: SessionView;
  onClose: () => void;
  onCreated: (c: Conversation | null) => void;
  group?: Conversation;
}) {
  const [mode, setMode] = useState<"DIRECT" | "GROUP">(
    group ? "GROUP" : "DIRECT",
  );
  const [query, setQuery] = useState("");
  const [users, setUsers] = useState<DirectoryUser[]>([]);
  const [selected, setSelected] = useState<DirectoryUser[]>([]);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = dialog.current;
    el?.showModal();
    return () => el?.close();
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void api<{ items: DirectoryUser[] }>(
        "/users?q=" + encodeURIComponent(query),
        { signal: controller.signal },
      )
        .then((r) =>
          setUsers(
            r.items.filter((u) => !group?.members.some((m) => m.id === u.id)),
          ),
        )
        .catch((e) => {
          if (!controller.signal.aborted)
            setError(
              e instanceof Error
                ? e.message
                : "Não foi possível buscar pessoas.",
            );
        });
    }, 180);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, group]);
  async function create() {
    setBusy(true);
    setError("");
    try {
      if (group) {
        for (const user of selected)
          await api("/conversations/" + group.id + "/members", {
            method: "POST",
            csrf: session.csrfToken,
            body: { userId: user.id },
          });
        onCreated(null);
      } else {
        const result = await api<Conversation>(
          mode === "DIRECT" ? "/conversations/direct" : "/conversations/groups",
          {
            method: "POST",
            csrf: session.csrfToken,
            body:
              mode === "DIRECT"
                ? { userId: selected[0].id }
                : { title, memberIds: selected.map((u) => u.id) },
          },
        );
        onCreated(result);
      }
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Não foi possível criar a conversa.",
      );
    } finally {
      setBusy(false);
    }
  }
  const enough = group
    ? selected.length > 0
    : mode === "DIRECT"
      ? selected.length === 1
      : selected.length >= 2 && title.trim().length > 0;
  return (
    <dialog
      className="new-dialog"
      ref={dialog}
      onCancel={onClose}
      aria-labelledby="dialog-title"
    >
      <div className="dialog-heading">
        <div>
          <span className="eyebrow">APROXIME AS SUAS PESSOAS</span>
          <h2 id="dialog-title">
            {group ? "Adicionar participantes" : "Uma nova conversa"}
          </h2>
        </div>
        <button className="icon-button" aria-label="Fechar" onClick={onClose}>
          <X size={20} />
        </button>
      </div>
      {!group && (
        <div className="dialog-tabs">
          <button
            className={mode === "DIRECT" ? "active" : ""}
            onClick={() => {
              setMode("DIRECT");
              setSelected([]);
            }}
          >
            <MessageCircle size={16} />
            Uma pessoa
          </button>
          <button
            className={mode === "GROUP" ? "active" : ""}
            onClick={() => {
              setMode("GROUP");
              setSelected([]);
            }}
          >
            <Users size={16} />
            Um grupo
          </button>
        </div>
      )}
      {mode === "GROUP" && !group && (
        <>
          <label htmlFor="group-title">Nome do grupo</label>
          <input
            id="group-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="ex.: Café com a turma"
            maxLength={80}
          />
        </>
      )}
      <label className="search-field">
        <Search size={17} />
        <input
          aria-label="Buscar pessoas"
          placeholder="Buscar nome ou usuário"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          maxLength={60}
        />
      </label>
      <p className="dialog-helper">
        {group
          ? "Escolha quem você quer convidar."
          : mode === "GROUP"
            ? "Escolha pelo menos duas pessoas."
            : "Quem você quer encontrar hoje?"}
      </p>
      <div className="people-list">
        {users.map((u) => {
          const checked = selected.some((s) => s.id === u.id);
          return (
            <button
              className={`person-option ${checked ? "selected" : ""}`}
              key={u.id}
              onClick={() =>
                setSelected((prev) =>
                  checked
                    ? prev.filter((p) => p.id !== u.id)
                    : mode === "DIRECT" && !group
                      ? [u]
                      : [...prev, u].slice(0, 49),
                )
              }
              aria-pressed={checked}
            >
              <span className="avatar">
                {u.displayName.slice(0, 1).toUpperCase()}
                <i
                  className={`status-dot ${u.online === true ? "" : "offline"}`}
                />
              </span>
              <span>
                <strong>{u.displayName}</strong>
                <small>
                  @{u.handle} ·{" "}
                  {u.online === null
                    ? "Presença indisponível"
                    : u.online
                      ? "Online"
                      : "Offline"}
                </small>
              </span>
              <span className="check-option">
                {checked && <Check size={16} />}
              </span>
            </button>
          );
        })}
        {!users.length && (
          <p className="empty-people">
            Nenhuma pessoa encontrada. Convide alguém para criar uma conta.
          </p>
        )}
      </div>
      {selected.length > 0 && (
        <div className="selected-summary">
          {selected.map((u) => u.displayName).join(", ")}
        </div>
      )}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      <button
        className="primary"
        disabled={!enough || busy}
        onClick={() => void create()}
      >
        {busy
          ? "Só um instante…"
          : group
            ? "Adicionar ao grupo"
            : mode === "GROUP"
              ? "Criar grupo"
              : "Começar conversa"}
        <ArrowRight size={17} />
      </button>
    </dialog>
  );
}
