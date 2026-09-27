// Quem recebeu convite (do operador ou de um municipal_admin da cidade) define
// a senha e entra (Plano 6). O token é a credencial: chega por e-mail, em
// ?invite= no host da cidade. A senha mínima (12) é a mesma da API, que
// responde `weak_password` se alguém escapar desta checagem.
import { useState, type FormEvent } from "react";
import { acceptInvitation, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";

const MIN_PASSWORD_LENGTH = 12;
const WEAK_PASSWORD = `A senha precisa ter pelo menos ${MIN_PASSWORD_LENGTH} caracteres.`;

function rejectionMessage(body: unknown): string {
  const code = body && typeof body === "object" ? (body as Record<string, unknown>).error : null;
  switch (code) {
    case "expired": return "Este convite expirou. Peça um novo convite a quem convidou você.";
    case "already_member": return "Você já faz parte da equipe desta cidade. Entre com seu e-mail e senha.";
    case "weak_password": return WEAK_PASSWORD;
    default: return "Convite inválido ou expirado. Peça um novo convite a quem convidou você.";
  }
}

export function AcceptInvitation({ token, onDone }: { token: string; onDone: () => void }) {
  const auth = useAuth();
  const [ password, setPassword ] = useState("");
  const [ confirmation, setConfirmation ] = useState("");
  const [ error, setError ] = useState<string | null>(null);
  const [ busy, setBusy ] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirmation) {
      setError("As senhas não conferem.");
      return;
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(WEAK_PASSWORD);
      return;
    }
    setBusy(true);
    try {
      await acceptInvitation(token, password);
      await auth.reload();
      onDone();
    } catch (err) {
      if (err instanceof ApiError && err.status === 422) {
        setError(rejectionMessage(err.body));
      } else if (err instanceof ApiError && err.status === 429) {
        setError("Muitas tentativas. Tente novamente em alguns minutos.");
      } else {
        setError("Não foi possível aceitar o convite. Tente novamente.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <form onSubmit={onSubmit}
        style={{ width: 320, display: "flex", flexDirection: "column", gap: 12, padding: 24,
          border: "1px solid var(--line, #e6e6e6)", borderRadius: 10 }}>
        <strong style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 14 }}>
          Definir senha de acesso
        </strong>
        <label style={{ fontSize: 12, color: "var(--ink2, #444)" }}>
          Senha
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoFocus
            minLength={MIN_PASSWORD_LENGTH}
            style={{ width: "100%", padding: 8, marginTop: 4, borderRadius: 6, border: "1px solid var(--line, #ccc)" }} />
        </label>
        <label style={{ fontSize: 12, color: "var(--ink2, #444)" }}>
          Confirmar senha
          <input type="password" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} required
            style={{ width: "100%", padding: 8, marginTop: 4, borderRadius: 6, border: "1px solid var(--line, #ccc)" }} />
        </label>
        {error && <p role="alert" style={{ color: "var(--danger, #c0341d)", fontSize: 12, margin: 0 }}>{error}</p>}
        <button type="submit" disabled={busy}
          style={{ padding: "8px 12px", borderRadius: 6, border: "none", cursor: busy ? "default" : "pointer",
            background: "var(--accent, #2b59ff)", color: "#fff", fontSize: 13 }}>
          {busy ? "Salvando…" : "Entrar"}
        </button>
      </form>
    </div>
  );
}
