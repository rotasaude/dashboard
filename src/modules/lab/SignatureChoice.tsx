// src/modules/lab/SignatureChoice.tsx
// ICP-Brasil (19b; o laudo espera a assinatura em Pendentes) ou assinatura
// eletrônica avançada do Rota Saúde (código do autenticador na hora). Médico
// (CRM) só ICP — o api confere de novo. O código vive só no estado de quem
// chama; aqui não se guarda nada.
import type { LabSignatureKind } from "../../lib/api";
import { onlyIcp } from "../../lib/lab";
import { inputStyle } from "../../components/formStyles";
import { checkLabel, fieldLabel, fieldset, legend, muted } from "../exams/styles";

export const NO_ICP_FOR_DOCTOR = "médico não libera nesta cidade — a assinatura ICP-Brasil não está ativa";

// `icpAvailable` (C5/B14): a cidade tem `digital_signature`. Sem ela a ICP não é
// oferecida nem é o padrão; o médico (CRM), que só assina com ICP, não libera.
export function SignatureChoice({ council, kind, onKind, totp, onTotp, icpAvailable = true }: {
  council: string | null; kind: LabSignatureKind; onKind(k: LabSignatureKind): void; totp: string; onTotp(code: string): void;
  icpAvailable?: boolean;
}) {
  const icpOnly = onlyIcp(council);
  if (icpOnly && !icpAvailable) {
    return (
      <fieldset style={fieldset}>
        <legend style={legend}>Assinatura do laudo</legend>
        <p style={muted}>{NO_ICP_FOR_DOCTOR}</p>
      </fieldset>
    );
  }
  return (
    <fieldset style={fieldset}>
      <legend style={legend}>Assinatura do laudo</legend>
      {icpAvailable && (
        <label style={checkLabel}>
          <input type="radio" name="lab-signature" checked={kind === "icp"} onChange={() => onKind("icp")} />
          ICP-Brasil (assina em Pendentes de assinatura)
        </label>
      )}
      {!icpOnly && (
        <label style={checkLabel}>
          <input type="radio" name="lab-signature" checked={kind === "advanced"} onChange={() => onKind("advanced")} />
          Assinatura eletrônica avançada (código do autenticador)
        </label>
      )}
      {icpOnly && <p style={muted}>médico (CRM) libera só com ICP-Brasil</p>}
      {kind === "advanced" && !icpOnly && (
        <label style={fieldLabel}>
          Código do autenticador
          <input value={totp} inputMode="numeric" autoComplete="one-time-code" maxLength={6} style={inputStyle}
            onChange={(e) => onTotp(e.target.value.replace(/\D/g, ""))} />
        </label>
      )}
    </fieldset>
  );
}
