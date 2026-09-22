import { useEffect, useState } from "react";
import { toDataURL } from "qrcode";
import { confirmMfa, enrollMfa, type MfaEnrollment } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useStepUp } from "../lib/useStepUp";
import { describeActionError } from "../lib/actionErrors";
import { SensitiveAction } from "../components/SensitiveAction";
import { PageHeader } from "../components/PageHeader";
import { Panel } from "../components/Panel";
import { buttonStyle, inputStyle } from "../components/formStyles";

// Segurança da conta (spec do dashboard §5.2). Cadastro e troca do
// autenticador do usuário da cidade — pré-requisito do step-up que assinar e
// aprovar exigem.
//
// Segredos: a chave, o QR e os códigos de recuperação vivem só no estado
// deste componente (somem ao sair da tela). O QR é gerado aqui, localmente —
// ele carrega o segredo e nunca vai para um serviço externo. `enrollMfa` só
// roda num clique: num efeito, o StrictMode chamaria duas vezes e o segundo
// cadastro trocaria o segredo do primeiro.
const RECOVERY_WARNING = "Cada código vale como o autenticador, uma única vez. Guarde-os fora do computador.";

export function Security() {
  const auth = useAuth();
  const { window } = useStepUp();
  const [ enrollment, setEnrollment ] = useState<MfaEnrollment | null>(null);
  const [ qr, setQr ] = useState<string | null>(null);
  const [ saved, setSaved ] = useState(false);
  const [ code, setCode ] = useState("");
  const [ busy, setBusy ] = useState(false);
  const [ error, setError ] = useState<string | null>(null);
  const [ done, setDone ] = useState(false);
  const [ replacing, setReplacing ] = useState(false);
  const [ viaReplace, setViaReplace ] = useState(false);

  useEffect(() => {
    if (!enrollment) { setQr(null); return; }
    let live = true;
    void toDataURL(enrollment.otpauth_uri).then((url) => { if (live) setQr(url); });
    return () => { live = false; };
  }, [ enrollment ]);

  function start(next: MfaEnrollment, replace = false) {
    setEnrollment(next); setSaved(false); setCode(""); setError(null); setDone(false);
    setReplacing(false); setViaReplace(replace);
  }

  async function begin() {
    if (busy) return;
    setBusy(true); setError(null);
    try { start(await enrollMfa()); }
    catch (err) {
      const described = describeActionError(err);
      setError("message" in described ? described.message : "não foi possível concluir — tente de novo");
    }
    finally { setBusy(false); }
  }

  async function confirm(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    const typed = code;
    setCode("");
    if (!typed.trim()) { setError("informe o código do autenticador"); return; }
    setBusy(true); setError(null);
    try {
      await confirmMfa(typed);
      await auth.reload();
      setEnrollment(null);
      setDone(true);
    } catch (err) {
      const described = describeActionError(err);
      setError(described.kind === "invalid_code"
        ? "código inválido — confira se o relógio do celular está certo"
        : "message" in described ? described.message : "não foi possível concluir — tente de novo");
    } finally {
      setBusy(false);
    }
  }

  const secret = enrollment ? new URL(enrollment.otpauth_uri).searchParams.get("secret") : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <PageHeader title="Segurança" sub="conta · autenticador" />
      <Panel title="Autenticador">
        <div style={{ display: "flex", flexDirection: "column", gap: 12, fontSize: 12.5 }}>
          {done && <p role="status" style={{ margin: 0 }}>autenticador ativo</p>}
          {error && <p role="alert" style={{ margin: 0, color: "var(--down)" }}>{error}</p>}

          {enrollment ? (
            <>
              {viaReplace && (
                <p style={{ margin: 0, fontWeight: 600 }}>
                  Seu autenticador anterior já não vale — confirme o novo para voltar a aprovar ações.
                </p>
              )}
              {qr && <img src={qr} alt="QR do autenticador" width={180} height={180} />}
              {secret && <p style={{ margin: 0 }}>Chave: <span className="mono">{secret}</span></p>}
              <p style={{ margin: 0, fontWeight: 600 }}>{RECOVERY_WARNING}</p>
              <ul className="mono" style={{ margin: 0 }}>
                {enrollment.recovery_codes.map((c) => <li key={c}>{c}</li>)}
              </ul>
              <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
                guardei os códigos
              </label>
              {saved && (
                <form onSubmit={confirm} style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: 280 }}>
                  <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    Código do autenticador
                    <input value={code} onChange={(e) => setCode(e.target.value)}
                           autoComplete="one-time-code" inputMode="numeric" style={inputStyle} />
                  </label>
                  <button type="submit" disabled={busy} style={buttonStyle}>Confirmar cadastro</button>
                </form>
              )}
            </>
          ) : window.enrolled ? (
            <>
              <p style={{ margin: 0 }}>Autenticador ativo.</p>
              {window.open && <p style={{ margin: 0 }}>verificação válida por mais {Math.ceil(window.remainingMs / 60_000)} min</p>}
              {replacing ? (
                <SensitiveAction
                  title="Trocar autenticador"
                  description="O autenticador atual deixa de valer assim que você confirmar esta etapa. Conclua o cadastro do novo sem sair da tela."
                  requiresStepUp
                  run={async () => { start(await enrollMfa(), true); }}
                  onDone={() => setReplacing(false)}
                  onCancel={() => setReplacing(false)}
                />
              ) : (
                <div><button type="button" onClick={() => setReplacing(true)} style={buttonStyle}>Trocar autenticador</button></div>
              )}
            </>
          ) : (
            <>
              <p style={{ margin: 0 }}>
                Cadastre um autenticador (Google Authenticator, 1Password, etc.) para assinar e aprovar ações sensíveis.
              </p>
              <div><button type="button" onClick={() => void begin()} disabled={busy} style={buttonStyle}>Cadastrar autenticador</button></div>
            </>
          )}
        </div>
      </Panel>
    </div>
  );
}
