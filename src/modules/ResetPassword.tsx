import { useState, type FormEvent } from "react";
import { resetPassword, ApiError } from "../lib/api";
import { useCityIdentity } from "../lib/cityIdentity";
import { EntryFrame } from "./entry/EntryFrame";

export function ResetPassword({ token }: { token: string }) {
  const [ password, setPassword ] = useState("");
  const [ confirm, setConfirm ] = useState("");
  const [ error, setError ] = useState<string | null>(null);
  const [ busy, setBusy ] = useState(false);
  const [ done, setDone ] = useState(false);
  const identity = useCityIdentity();

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

  return (
    <EntryFrame identity={identity}>
      <h1 className="entry-title">Redefinir senha</h1>
      {done ? (
        <>
          <p className="entry-note">Senha redefinida com sucesso.</p>
          <button type="button" className="entry-btn" onClick={goToLogin}>Ir para o login</button>
        </>
      ) : (
        <form onSubmit={onSubmit}>
          <label className="entry-field">
            Nova senha
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} required autoFocus />
          </label>
          <label className="entry-field">
            Confirmar senha
            <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} required />
          </label>
          {error && <p role="alert" className="entry-alert">{error}</p>}
          <button type="submit" className="entry-btn" disabled={busy}>{busy ? "Redefinindo…" : "Redefinir senha"}</button>
        </form>
      )}
    </EntryFrame>
  );
}
