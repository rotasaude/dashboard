import { useState, type FormEvent } from "react";
import { resetPassword, ApiError } from "../lib/api";

export function ResetPassword({ token }: { token: string }) {
  const [ password, setPassword ] = useState("");
  const [ confirm, setConfirm ] = useState("");
  const [ error, setError ] = useState<string | null>(null);
  const [ busy, setBusy ] = useState(false);
  const [ done, setDone ] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) { setError("As senhas não coincidem."); return; }
    setBusy(true);
    try {
      await resetPassword(token, password, confirm);
      setDone(true);
    } catch (err) {
      if (err instanceof ApiError && err.status === 422) {
        const body = err.body as { error?: string; errors?: string[] };
        if (body?.error === "invalid_token") setError("Link inválido ou expirado. Solicite um novo.");
        else if (body?.errors?.length) setError(body.errors.join(" "));
        else setError("Não foi possível redefinir a senha.");
      } else {
        setError("Não foi possível redefinir a senha. Tente novamente.");
      }
    } finally {
      setBusy(false);
    }
  }

  function goToLogin() {
    window.location.assign(window.location.pathname);
  }

  const inputStyle = { width: "100%", padding: 8, marginTop: 4, borderRadius: 6, border: "1px solid var(--line, #ccc)" } as const;

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ width: 320, display: "flex", flexDirection: "column", gap: 12, padding: 24,
        border: "1px solid var(--line, #e6e6e6)", borderRadius: 10 }}>
        <strong style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 14 }}>Redefinir senha</strong>
        {done ? (
          <>
            <p style={{ fontSize: 13, margin: 0 }}>Senha redefinida com sucesso.</p>
            <button onClick={goToLogin} style={btnStyle}>Ir para o login</button>
          </>
        ) : (
          <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <label style={{ fontSize: 12, color: "var(--ink2, #444)" }}>
              Nova senha
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} required autoFocus style={inputStyle} />
            </label>
            <label style={{ fontSize: 12, color: "var(--ink2, #444)" }}>
              Confirmar senha
              <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} required style={inputStyle} />
            </label>
            {error && <p role="alert" style={{ color: "var(--danger, #c0341d)", fontSize: 12, margin: 0 }}>{error}</p>}
            <button type="submit" disabled={busy} style={btnStyle}>{busy ? "Redefinindo…" : "Redefinir senha"}</button>
          </form>
        )}
      </div>
    </div>
  );
}

const btnStyle = { padding: "8px 12px", borderRadius: 6, border: "none", cursor: "pointer",
  background: "var(--accent, #2b59ff)", color: "#fff", fontSize: 13 } as const;
