import { useState, type FormEvent } from "react";
import { useAuth } from "../lib/auth";
import { ApiError, requestPasswordReset } from "../lib/api";

export function Login() {
  const auth = useAuth();
  const [ mode, setMode ] = useState<"login" | "forgot">("login");
  const [ sent, setSent ] = useState(false);
  const [ email, setEmail ] = useState("");
  const [ password, setPassword ] = useState("");
  const [ error, setError ] = useState<string | null>(null);
  const [ busy, setBusy ] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await auth.login(email, password);
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 422)) {
        setError("E-mail ou senha inválidos.");
      } else {
        setError("Não foi possível entrar. Tente novamente.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function onForgot(e: FormEvent) {
    e.preventDefault();
    try {
      await requestPasswordReset(email);
    } catch {
      /* no-enumeration: mensagem idêntica */
    } finally {
      setSent(true);
    }
  }

  const inputStyle = {
    width: "100%", padding: 8, marginTop: 4, borderRadius: 6,
    border: "1px solid var(--line, #ccc)"
  } as const;

  const btnStyle = {
    padding: "8px 12px", borderRadius: 6, border: "none", cursor: "pointer",
    background: "var(--accent, #2b59ff)", color: "#fff", fontSize: 13
  } as const;

  if (mode === "forgot") {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ width: 320, display: "flex", flexDirection: "column", gap: 12, padding: 24,
          border: "1px solid var(--line, #e6e6e6)", borderRadius: 10 }}>
          <strong style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 14 }}>
            Esqueci minha senha
          </strong>
          {sent ? (
            <>
              <p style={{ fontSize: 12, margin: 0 }}>Se o e-mail existir, enviamos um link para redefinir a senha.</p>
              <button type="button" onClick={() => { setMode("login"); setSent(false); }} style={btnStyle}>
                Voltar ao login
              </button>
            </>
          ) : (
            <form onSubmit={onForgot} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <label style={{ fontSize: 12, color: "var(--ink2, #444)" }}>
                E-mail
                <input type="email" value={email} onChange={e => setEmail(e.target.value)} required autoFocus style={inputStyle} />
              </label>
              <button type="submit" style={btnStyle}>Enviar link</button>
              <button type="button" onClick={() => setMode("login")}
                style={{ background: "none", border: "none", color: "var(--accent, #2b59ff)", cursor: "pointer", fontSize: 12, padding: 0 }}>
                Voltar ao login
              </button>
            </form>
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <form onSubmit={onSubmit}
        style={{ width: 320, display: "flex", flexDirection: "column", gap: 12, padding: 24,
          border: "1px solid var(--line, #e6e6e6)", borderRadius: 10 }}>
        <strong style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 14 }}>
          Rota Saúde — Dashboard
        </strong>
        <label style={{ fontSize: 12, color: "var(--ink2, #444)" }}>
          E-mail
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} required autoFocus style={inputStyle} />
        </label>
        <label style={{ fontSize: 12, color: "var(--ink2, #444)" }}>
          Senha
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} required style={inputStyle} />
        </label>
        {error && <p role="alert" style={{ color: "var(--danger, #c0341d)", fontSize: 12, margin: 0 }}>{error}</p>}
        <button type="submit" disabled={busy}
          style={{ padding: "8px 12px", borderRadius: 6, border: "none", cursor: busy ? "default" : "pointer",
            background: "var(--accent, #2b59ff)", color: "#fff", fontSize: 13 }}>
          {busy ? "Entrando…" : "Entrar"}
        </button>
        <button type="button" onClick={() => setMode("forgot")}
          style={{ background: "none", border: "none", color: "var(--accent, #2b59ff)", cursor: "pointer", fontSize: 12, padding: 0 }}>
          Esqueci minha senha
        </button>
      </form>
    </div>
  );
}
