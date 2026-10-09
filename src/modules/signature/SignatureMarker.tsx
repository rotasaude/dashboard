// src/modules/signature/SignatureMarker.tsx
// Marcador de assinatura de um documento (módulo 19b; spec §9; contrato §2):
// digital (válida, inválida, indeterminada), pendente (com o motivo) ou à mão.
// Só a assinatura digital tem conteúdo para abrir; a simulada avisa (R10).
import { useState, type CSSProperties } from "react";
import type { SignatureBlock, SignatureVerification } from "../../lib/api";
import { SIMULATED_NOTICE, signatureMarker } from "../../lib/signature";
import { Tag } from "../../components/Tag";
import { SignatureDetail } from "./SignatureDetail";

interface Props {
  label: string;
  block: SignatureBlock;
  // Leitura administrativa (Ruling R6): step-up e só o conteúdo.
  readOnly?: boolean;
  consultationId?: string;
  onOpeningRequired?(): void;
}

export function SignatureMarker({ label, block, readOnly, consultationId, onOpeningRequired }: Props) {
  const [ open, setOpen ] = useState(false);
  // Revalidar devolve a validação nova antes de a consulta ser relida; vale
  // enquanto o bloco que veio do api não mudar (a releitura prevalece).
  const [ verified, setVerified ] = useState<{ from?: SignatureVerification; to: SignatureVerification } | null>(null);
  const current = verified && verified.from === block.verification ? { ...block, verification: verified.to } : block;
  const marker = signatureMarker(current);
  const canOpen = block.mode === "digital" && !!block.signature_id;

  return (
    <div role="group" aria-label={label} style={wrap}>
      <div style={row}>
        <Tag tone={marker.tone}>{marker.label}</Tag>
        {marker.simulated && <Tag tone="warn" mono={false}>{SIMULATED_NOTICE}</Tag>}
        {marker.detail && <span style={muted}>{marker.detail}</span>}
        {canOpen && (
          <button type="button" style={linkButton} onClick={() => setOpen((v) => !v)}>
            {open ? "Fechar o que foi assinado" : "Ver o que foi assinado"}
          </button>
        )}
      </div>
      {open && block.signature_id && (
        <SignatureDetail id={block.signature_id} readOnly={readOnly} onOpeningRequired={onOpeningRequired}
          consultationId={consultationId} onVerified={(d) => setVerified({ from: block.verification, to: d.verification })} onClose={() => setOpen(false)} />
      )}
    </div>
  );
}

const wrap: CSSProperties = { display: "flex", flexDirection: "column", gap: 8 };
const row: CSSProperties = { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" };
const muted: CSSProperties = { fontSize: 12, color: "var(--ink3)" };
const linkButton: CSSProperties = {
  border: "none", background: "transparent", padding: 0, cursor: "pointer", fontSize: 12,
  color: "var(--accent)", textDecoration: "underline"
};
