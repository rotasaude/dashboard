// Certificado A1 da RNDS (módulo 29; ADR 0047; F-29.1). Passo 1 confere o
// arquivo e o CNES; passo 2 pede a senha do certificado no step-up. O arquivo
// e a senha vivem só neste componente: fechar descarta tudo. O nome do .pfx
// aparece na tela e não vai a lugar nenhum (nem URL, nem console, nem storage).
import { useState, type FormEvent } from "react";
import { setRndsCredential, type IntegrationCredential } from "../../lib/api";
import { cnesProblem, credentialLabel, integrationsError, pfxProblem } from "../../lib/integrations";
import { SensitiveAction } from "../../components/SensitiveAction";
import { buttonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";

const SCREEN_ERRORS = [ "invalid_credential", "invalid_certificate", "certificate_expired", "invalid_requester_cnes" ];
const SAVED = "Certificado da RNDS salvo. Teste a conexão para conferir a troca de token.";

export function RndsCredentialForm({ credential, onDone, onCancel, onGoToSecurity }: {
  credential: IntegrationCredential;
  onDone(message: string): void;
  onCancel(): void;
  onGoToSecurity?(): void;
}) {
  const [ file, setFile ] = useState<File | null>(null);
  const [ cnes, setCnes ] = useState("");
  const [ problems, setProblems ] = useState<{ file: string | null; cnes: string | null }>({ file: null, cnes: null });
  const [ confirmed, setConfirmed ] = useState(false);
  const title = `${credential.set ? "Trocar" : "Cadastrar"} credencial — ${credentialLabel("rnds")}`;

  if (confirmed && file) {
    return (
      <SensitiveAction
        title={title}
        description={`Certificado escolhido: ${file.name}. A senha e o certificado são gravados cifrados e não aparecem de novo, nem para você.`}
        requiresStepUp
        fields={[ { name: "password", label: "Senha do certificado", type: "password", required: true } ]}
        confirmLabel="Salvar certificado"
        run={async (values) => { await setRndsCredential(file, values.password, cnes.trim()); }}
        onDone={() => { setFile(null); onDone(SAVED); }}
        onCancel={() => { setFile(null); onCancel(); }}
        onGoToSecurity={onGoToSecurity}
        translateError={(err) => {
          const code = (err as { body?: { error?: string } })?.body?.error;
          return code && SCREEN_ERRORS.includes(code) ? integrationsError(err) : null;
        }}
      />
    );
  }

  function next(event: FormEvent) {
    event.preventDefault();
    const found = { file: pfxProblem(file), cnes: cnesProblem(cnes) };
    setProblems(found);
    if (!found.file && !found.cnes) setConfirmed(true);
  }

  return (
    <section aria-label={title} style={panel}>
      <strong>{title}</strong>
      <p style={text}>Use o certificado A1 da secretaria (arquivo .pfx ou .p12). Ele só é enviado ao salvar e não aparece de novo.</p>
      <form onSubmit={next} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <label style={label}>
          Certificado A1
          <input type="file" accept=".pfx,.p12,application/x-pkcs12" style={inputStyle}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </label>
        {file && <p style={text}>escolhido: {file.name}</p>}
        {problems.file && <p role="alert" style={alert}>{problems.file}</p>}
        <label style={label}>
          CNES solicitante
          <input value={cnes} inputMode="numeric" autoComplete="off" onChange={(e) => setCnes(e.target.value)} style={inputStyle} />
        </label>
        {problems.cnes && <p role="alert" style={alert}>{problems.cnes}</p>}
        <div style={{ display: "flex", gap: 8 }}>
          <button type="submit" style={buttonStyle}>Continuar</button>
          <button type="button" onClick={() => { setFile(null); onCancel(); }} style={secondaryButtonStyle}>Cancelar</button>
        </div>
      </form>
    </section>
  );
}

const panel = { display: "flex", flexDirection: "column" as const, gap: 10, padding: 16,
  border: "1px solid var(--rule)", borderRadius: 8, background: "var(--panel)" };
const text = { margin: 0, fontSize: 12.5, color: "var(--ink2)" };
const label = { display: "flex", flexDirection: "column" as const, gap: 4, fontSize: 12, color: "var(--ink2)" };
const alert = { margin: 0, fontSize: 12, color: "var(--down)" };
