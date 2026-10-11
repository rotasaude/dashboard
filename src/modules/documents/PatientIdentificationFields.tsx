// src/modules/documents/PatientIdentificationFields.tsx
// Identificação do paciente na receita de controle especial (módulo 19d; spec
// §5; contrato §2): o CPF é o do cadastro (a tela só mostra mascarado e nunca
// o envia — o api usa o do paciente; sem "não possui CPF", decisão do usuário)
// e o endereço completo, digitado ou o da última receita do paciente.
import type { IdentificationDraft } from "../../lib/controlled";
import { secondaryButtonStyle } from "../../components/formStyles";
import { AddressFields } from "./AddressFields";
import { box, legendStyle, mutedStyle, rowStyle } from "./formStyles";

interface Props {
  value: IdentificationDraft;
  onChange(next: IdentificationDraft): void;
  cpfMasked?: string;
  onUseLast?(): void;
  lastNote?: string | null;
}

export function PatientIdentificationFields({ value, onChange, cpfMasked, onUseLast, lastNote }: Props) {
  return (
    <fieldset aria-label="Identificação do paciente" style={box}>
      <legend style={legendStyle}>Identificação do paciente (receita de controle especial)</legend>
      <p style={mutedStyle}>CPF do cadastro: <span className="mono">{cpfMasked ?? "—"}</span></p>
      {onUseLast && (
        <div style={rowStyle}>
          <button type="button" style={secondaryButtonStyle} onClick={onUseLast}>Usar a última identificação</button>
          {lastNote && <small style={mutedStyle}>{lastNote}</small>}
        </div>
      )}
      <AddressFields legend="Endereço do paciente" value={value.address} onChange={(address) => onChange({ ...value, address })} />
    </fieldset>
  );
}
