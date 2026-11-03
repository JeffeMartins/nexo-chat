import { useState } from "react";
import {
  ArrowRight,
  MessageCircle,
  ShieldCheck,
  Users,
  Eye,
  EyeOff,
} from "lucide-react";
import type { SessionView } from "@conversa/contracts";
import { api } from "./api";
export default function AuthPage({
  onSession,
}: {
  onSession: (s: SessionView) => void;
}) {
  const [register, setRegister] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [visible, setVisible] = useState(false);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      const data = {
        email: String(form.get("email")),
        password: String(form.get("password")),
        ...(register
          ? {
              displayName: String(form.get("displayName")),
              handle: String(form.get("handle")),
            }
          : {}),
      };
      onSession(
        await api<SessionView>(register ? "/auth/register" : "/auth/login", {
          method: "POST",
          body: data,
        }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível entrar.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth-layout">
      <section className="auth-form-side">
        <a href="/" className="wordmark">
          <span className="brand-icon">
            <MessageCircle size={23} />
          </span>
          conversa<span className="brand-dot">.</span>
        </a>
        <div className="auth-form-wrap">
          <span className="eyebrow">PERTO DE QUEM IMPORTA</span>
          <h1>
            {register
              ? `Toda boa conversa\ncomeça com um olá.`
              : `Bom ter você\npor aqui.`}
          </h1>
          <p className="muted">
            {register
              ? "Crie sua conta e encontre as suas pessoas."
              : "Entre na sua conta. Suas conversas estão esperando."}
          </p>
          <form onSubmit={submit}>
            {register && (
              <>
                <label htmlFor="name">Seu nome</label>
                <input
                  id="name"
                  name="displayName"
                  autoComplete="name"
                  minLength={2}
                  maxLength={60}
                  placeholder="Como podemos chamar você?"
                  required
                />
                <label htmlFor="handle">Nome de usuário</label>
                <input
                  id="handle"
                  name="handle"
                  autoComplete="username"
                  pattern="[a-z0-9_]{3,24}"
                  minLength={3}
                  maxLength={24}
                  placeholder="ex.: ana_martins"
                  required
                />
                <small>Letras minúsculas, números e _.</small>
              </>
            )}
            <label htmlFor="email">E-mail</label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              maxLength={254}
              placeholder="voce@exemplo.com"
              required
            />
            <label htmlFor="password">Senha</label>
            <div className="password-field">
              <input
                id="password"
                name="password"
                type={visible ? "text" : "password"}
                autoComplete={register ? "new-password" : "current-password"}
                minLength={12}
                maxLength={128}
                placeholder="Pelo menos 12 caracteres"
                required
              />
              <button
                type="button"
                className="icon-button"
                onClick={() => setVisible((v) => !v)}
                aria-label={visible ? "Ocultar senha" : "Mostrar senha"}
              >
                {visible ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
            {error && (
              <p role="alert" className="form-error">
                {error}
              </p>
            )}
            <button className="primary auth-submit" disabled={busy}>
              {busy
                ? "Só um instante…"
                : register
                  ? "Criar minha conta"
                  : "Entrar na conversa"}
              <ArrowRight size={18} />
            </button>
          </form>
          <p className="auth-switch">
            {register ? "Já tem uma conta?" : "Ainda não tem conta?"}{" "}
            <button
              className="text-button"
              onClick={() => {
                setRegister((v) => !v);
                setError("");
              }}
            >
              {register ? "Entrar" : "Criar conta"}
            </button>
          </p>
          <div className="auth-trust">
            <ShieldCheck size={16} />
            <span>Seu e-mail não aparece para outras pessoas.</span>
          </div>
        </div>
        <small className="auth-footer">
          Conexões de verdade. Uma mensagem de cada vez.
        </small>
      </section>
      <aside className="auth-art">
        <div className="art-top">
          <span className="pill">UM ESPAÇO PARA CONECTAR</span>
          <span className="art-spark">✳</span>
        </div>
        <div className="preview-chat">
          <div className="preview-header">
            <span className="avatar coral">J</span>
            <div>
              <strong>Júlia</strong>
              <small>
                <i className="status-dot" />
                Online agora
              </small>
            </div>
            <MessageCircle size={20} />
          </div>
          <div className="preview-day">UMA BOA CONVERSA</div>
          <div className="preview-bubble">
            Tem um minutinho para conversar? <span>14:32</span>
          </div>
          <div className="preview-bubble mine">
            Para você? Sempre. ☀️<span>14:32</span>
          </div>
          <div className="preview-bubble">
            É bom ter você por perto.<span>14:33</span>
          </div>
          <div className="preview-typing">
            <i />
            <i />
            <i />
          </div>
          <small className="preview-caption">
            Ilustração · conversas fictícias
          </small>
        </div>
        <div className="art-copy">
          <h2>
            Menos distância.
            <br />
            Mais conversa.
          </h2>
          <p>
            Encontre quem está online, troque uma ideia
            <br />
            ou reúna a turma no mesmo lugar.
          </p>
          <div className="art-features">
            <span>
              <MessageCircle size={17} />
              Em tempo real
            </span>
            <span>
              <Users size={17} />
              Do seu jeito
            </span>
          </div>
        </div>
        <div className="art-bottom">
          <span>01 / CONECTAR É SIMPLES</span>
          <span>↗</span>
        </div>
      </aside>
    </main>
  );
}
