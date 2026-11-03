import { useEffect, useState } from "react";
import type { SessionView } from "@nexo/contracts";
import { MessageCircle } from "lucide-react";
import { api } from "./api";
import AuthPage from "./AuthPage";
import ChatPage from "./ChatPage";
export default function App() {
  const [session, setSession] = useState<SessionView | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    void api<SessionView>("/auth/me")
      .then((s) => {
        if (alive) setSession(s);
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setLoading(false);
      });
    const expire = () => setSession(null);
    window.addEventListener("auth:expired", expire);
    return () => {
      alive = false;
      window.removeEventListener("auth:expired", expire);
    };
  }, []);
  useEffect(() => {
    if (!session) return;
    const t = setTimeout(
      () => setSession(null),
      Math.max(0, new Date(session.expiresAt).getTime() - Date.now()),
    );
    return () => clearTimeout(t);
  }, [session]);
  if (loading)
    return (
      <main className="loading-screen">
        <MessageCircle size={34} />
        <span>Abrindo espaço para uma boa conversa…</span>
      </main>
    );
  return session ? (
    <ChatPage
      key={session.user.id}
      session={session}
      onLogout={() => setSession(null)}
    />
  ) : (
    <AuthPage onSession={setSession} />
  );
}
