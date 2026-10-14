// src/modules/examsAdmin/ProviderAccess.tsx
// Acessos do prestador (contrato §5): o token FHIR do laboratório (mostrado
// UMA vez — vive só neste estado, nunca no cache; some com "Já guardei" ou
// ao fechar) e o convite do usuário `exam_provider` (o mecanismo de convite
// existente; o usuário entra só no portal).
import { useState } from "react";
import { errorCode, inviteProviderUser, revokeFhirToken, rotateFhirToken, type ExamProvider } from "../../lib/api";
import { examError } from "../../lib/exams";
import { inviteErrorMessage, isValidEmail } from "../../lib/team";
import { SensitiveAction } from "../../components/SensitiveAction";
import { dangerButtonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alert, box, fieldLabel, muted, okText, row } from "../exams/styles";

type Confirming = null | "rotate" | "revoke" | { invite: string };
const translate = (err: unknown) => (errorCode(err) ? examError(err) : null);

export function ProviderAccess({ provider, onGoToSecurity, onChanged, onClose }: {
  provider: ExamProvider; onGoToSecurity?(): void; onChanged(): void; onClose(): void;
}) {
  const [ confirming, setConfirming ] = useState<Confirming>(null);
  const [ token, setToken ] = useState<string | null>(null);
  const [ copyNote, setCopyNote ] = useState<string | null>(null);
  const [ email, setEmail ] = useState("");
  const [ emailError, setEmailError ] = useState<string | null>(null);
  const [ notice, setNotice ] = useState<string | null>(null);
  const hasToken = provider.has_fhir_token === true;
  const idle = confirming === null && token === null;

  async function copy() {
    try {
      await navigator.clipboard.writeText(token ?? "");
      setCopyNote("token copiado");
    } catch {
      setCopyNote("não foi possível copiar — selecione o token e copie");
    }
  }

  function invite() {
    if (!isValidEmail(email)) { setEmailError("e-mail inválido"); return; }
    setEmailError(null);
    setNotice(null);
    setConfirming({ invite: email.trim() });
  }

  return (
    <section aria-label={`Acesso de ${provider.name}`} style={box}>
      <strong>{`Acesso de ${provider.name}`}</strong>
      <p style={muted}>O token FHIR é do sistema do laboratório (resultados automáticos). O usuário do prestador entra só no portal, sem prontuário.</p>
      {notice && <p role="status" style={okText}>{notice}</p>}

      {token && (
        <section aria-label="Token FHIR novo" style={box}>
          <p style={alert}>Copie agora: o token não aparece de novo. Ele substitui o anterior, que deixa de funcionar.</p>
          <code className="mono" style={{ overflowWrap: "anywhere", fontSize: 13 }}>{token}</code>
          <div style={row}>
            <button type="button" style={secondaryButtonStyle} onClick={() => void copy()}>Copiar</button>
            <button type="button" style={secondaryButtonStyle} onClick={() => { setToken(null); setCopyNote(null); }}>Já guardei</button>
          </div>
          {copyNote && <p role="status" style={muted}>{copyNote}</p>}
        </section>
      )}

      {idle && (
        <div style={row}>
          <button type="button" style={secondaryButtonStyle} onClick={() => { setNotice(null); setConfirming("rotate"); }}>
            {hasToken ? "Trocar token FHIR" : "Gerar token FHIR"}
          </button>
          {hasToken && (
            <button type="button" style={dangerButtonStyle} onClick={() => { setNotice(null); setConfirming("revoke"); }}>Revogar token FHIR</button>
          )}
        </div>
      )}
      {confirming === "rotate" && (
        <SensitiveAction
          title={`${hasToken ? "Trocar" : "Gerar"} token FHIR — ${provider.name}`}
          description={hasToken ? "O token atual deixa de funcionar na hora." : "O laboratório usa o token para enviar resultados e ler as guias agendadas."}
          requiresStepUp confirmLabel={hasToken ? "Trocar token" : "Gerar token"}
          run={async () => { setToken(await rotateFhirToken(provider.id)); }}
          onDone={() => { setConfirming(null); onChanged(); }}
          onCancel={() => setConfirming(null)} onGoToSecurity={onGoToSecurity} translateError={translate}
        />
      )}
      {confirming === "revoke" && (
        <SensitiveAction
          title={`Revogar token FHIR — ${provider.name}`}
          description="O laboratório deixa de enviar resultados até receber um token novo."
          requiresStepUp confirmLabel="Revogar token"
          run={async () => { await revokeFhirToken(provider.id); }}
          onDone={() => { setConfirming(null); setNotice("Token revogado."); onChanged(); }}
          onCancel={() => setConfirming(null)} onGoToSecurity={onGoToSecurity} translateError={translate}
        />
      )}

      {idle && (
        <div style={{ ...row, alignItems: "flex-end" }}>
          <label style={fieldLabel}>
            E-mail do usuário do prestador
            <input type="email" value={email} autoComplete="off" style={inputStyle} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <button type="button" style={secondaryButtonStyle} onClick={invite}>Convidar</button>
        </div>
      )}
      {emailError && <p role="alert" style={alert}>{emailError}</p>}
      {confirming !== null && typeof confirming === "object" && (
        <SensitiveAction
          title={`Convidar usuário do prestador — ${provider.name}`}
          description={`Convite para ${confirming.invite}. A pessoa cria a senha e o autenticador ao aceitar.`}
          requiresStepUp confirmLabel="Enviar convite"
          run={async () => { await inviteProviderUser(provider.id, confirming.invite); }}
          onDone={() => { setNotice(`Convite enviado para ${confirming.invite}.`); setConfirming(null); setEmail(""); }}
          onCancel={() => setConfirming(null)} onGoToSecurity={onGoToSecurity}
          translateError={(err) => inviteErrorMessage(err) ?? translate(err)}
        />
      )}
      <div><button type="button" style={secondaryButtonStyle} onClick={onClose}>Fechar</button></div>
    </section>
  );
}
