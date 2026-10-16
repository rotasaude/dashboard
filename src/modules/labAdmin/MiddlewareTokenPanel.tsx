// src/modules/labAdmin/MiddlewareTokenPanel.tsx
// Token do middleware do fornecedor (spec §6; contrato §3 e §7): mostrado UMA
// vez — vive só neste estado, nunca no cache; some com "Já guardei" ou ao
// sair. Trocar invalida o anterior. Sem `lab_hl7_inbound`, avisa que o token
// só funciona quando a entrada for ligada (no maintenance).
import { useState } from "react";
import { revokeMiddlewareToken, rotateMiddlewareToken, type ExamProvider } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { hasFeature } from "../../lib/features";
import { labError } from "../../lib/lab";
import { Panel } from "../../components/Panel";
import { SensitiveAction } from "../../components/SensitiveAction";
import { dangerButtonStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alert, box, muted, okText, row, stack } from "../exams/styles";

export function MiddlewareTokenPanel({ provider, onChanged, onGoToSecurity }: { provider: ExamProvider; onChanged(): void; onGoToSecurity?(): void }) {
  const { user } = useAuth();
  const [ confirming, setConfirming ] = useState<null | "rotate" | "revoke">(null);
  const [ token, setToken ] = useState<string | null>(null);
  const [ notice, setNotice ] = useState<string | null>(null);
  const hasToken = provider.has_middleware_token === true;
  const idle = confirming === null && token === null;

  return (
    <Panel title="Middleware dos aparelhos" sub="token do sistema do fornecedor que envia resultados por HL7">
      <div style={stack}>
        {!hasFeature(user, "lab_hl7_inbound") && (
          <p style={muted}>a entrada de resultados de aparelhos (HL7) está desligada nesta cidade — o token só funciona quando ela for ligada</p>
        )}
        {notice && <p role="status" style={okText}>{notice}</p>}
        {token && (
          <section aria-label="Token do middleware novo" style={box}>
            <p style={alert}>Copie agora: o token não aparece de novo. Ele substitui o anterior, que deixa de funcionar.</p>
            <code className="mono" style={{ overflowWrap: "anywhere", fontSize: 13, userSelect: "all" }}>{token}</code>
            <div style={row}><button type="button" style={secondaryButtonStyle} onClick={() => setToken(null)}>Já guardei</button></div>
          </section>
        )}
        {idle && (
          <div style={row}>
            <button type="button" style={secondaryButtonStyle} onClick={() => { setNotice(null); setConfirming("rotate"); }}>
              {hasToken ? "Trocar token do middleware" : "Gerar token do middleware"}
            </button>
            {hasToken && <button type="button" style={dangerButtonStyle} onClick={() => { setNotice(null); setConfirming("revoke"); }}>Revogar token do middleware</button>}
          </div>
        )}
        {confirming === "rotate" && (
          <SensitiveAction title={`${hasToken ? "Trocar" : "Gerar"} token do middleware — ${provider.name}`}
            description={hasToken ? "O token atual deixa de funcionar na hora." : "O middleware usa o token para pedir a lista de trabalho e enviar resultados."}
            requiresStepUp confirmLabel={hasToken ? "Trocar token" : "Gerar token"}
            run={async () => { setToken(await rotateMiddlewareToken(provider.id)); }}
            onDone={() => { setConfirming(null); onChanged(); }} onCancel={() => setConfirming(null)} onGoToSecurity={onGoToSecurity}
            translateError={(err) => labError(err)} />
        )}
        {confirming === "revoke" && (
          <SensitiveAction title={`Revogar token do middleware — ${provider.name}`} description="O middleware deixa de enviar resultados até receber um token novo."
            requiresStepUp confirmLabel="Revogar token"
            run={async () => { await revokeMiddlewareToken(provider.id); }}
            onDone={() => { setConfirming(null); setNotice("Token revogado."); onChanged(); }} onCancel={() => setConfirming(null)}
            onGoToSecurity={onGoToSecurity} translateError={(err) => labError(err)} />
        )}
      </div>
    </Panel>
  );
}
