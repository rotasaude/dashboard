// Login do dashboard dentro da moldura de entrada da cidade (spec
// city-identity §5): quem começa o turno vê em que prefeitura está entrando.
import { useState, type FormEvent } from "react";
import { useAuth } from "../lib/auth";
import { ApiError, requestPasswordReset, startGovBr } from "../lib/api";
import { cityLabel, shiftGreeting, useCityIdentity } from "../lib/cityIdentity";
import { EntryFrame } from "./entry/EntryFrame";

export function Login({ expiredGrant = false }: { expiredGrant?: boolean }) {
  const auth = useAuth();
  const identity = useCityIdentity();
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

  // Saudação calculada no render, sem timer: no fuso da cidade quando há
  // identidade, no do navegador enquanto ela carrega ou se falhou.
  const greeting = shiftGreeting(new Date(), identity?.time_zone);

  if (mode === "forgot") {
    return (
      <EntryFrame identity={identity}>
        <h1 className="entry-title">Esqueci minha senha</h1>
        {sent ? (
          <>
            <p className="entry-note">Se o e-mail existir, enviamos um link para redefinir a senha.</p>
            <button type="button" className="entry-btn" onClick={() => { setMode("login"); setSent(false); }}>
              Voltar ao login
            </button>
          </>
        ) : (
          <form onSubmit={onForgot}>
            <label className="entry-field">
              E-mail
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} required autoFocus />
            </label>
            <button type="submit" className="entry-btn">Enviar link</button>
            <button type="button" className="entry-link" onClick={() => setMode("login")}>
              Voltar ao login
            </button>
          </form>
        )}
      </EntryFrame>
    );
  }

  return (
    <EntryFrame identity={identity}>
      <h1 className="entry-sr">{identity ? `Entrar no painel de ${identity.name}` : "Entrar no painel"}</h1>
      <p className="entry-greeting">{greeting}</p>
      {identity
        ? <p className="entry-lead">Entre para começar o turno em <strong>{cityLabel(identity)}</strong>.</p>
        : <p className="entry-lead">Entre para começar o turno.</p>}
      <form onSubmit={onSubmit}>
        <label className="entry-field">
          E-mail
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} required autoFocus />
        </label>
        <label className="entry-field">
          Senha
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} required />
        </label>
        {expiredGrant && (
          <p role="alert" className="entry-alert">
            O link de entrada expirou (vale 60 segundos). Entre com e-mail e senha, ou peça um novo acesso.
          </p>
        )}
        {error && <p role="alert" className="entry-alert">{error}</p>}
        <button type="submit" className="entry-btn" disabled={busy}>
          {busy ? "Entrando…" : "Entrar"}
        </button>
        <button type="button" className="entry-btn entry-btn-secondary" onClick={() => { void goToGovBr(setError); }}>
          Entrar com gov.br
        </button>
        <button type="button" className="entry-link" onClick={() => setMode("forgot")}>
          Esqueci minha senha
        </button>
      </form>
    </EntryFrame>
  );
}

// O gov.br é da CIDADE: o backend monta authorize_url com o state assinado
// (cidade + nonce) e o callback único em auth.* devolve o navegador para cá
// com ?grant= (Planos 3B e 6).
async function goToGovBr(setError: (m: string | null) => void) {
  try {
    window.location.href = await startGovBr();
  } catch {
    setError("gov.br indisponível no momento. Entre com e-mail e senha.");
  }
}
