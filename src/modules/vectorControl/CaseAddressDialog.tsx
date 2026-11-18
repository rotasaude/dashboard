// src/modules/vectorControl/CaseAddressDialog.tsx
// Endereço do caso do bloqueio sem quarteirão (módulo 35a, F-35.7; contrato §8, §17; W-3; Q26(3)). A única leitura do 35a com
// endereço de pessoa: só por clique, com step-up (SensitiveAction), e o api grava a trilha (clinical_record.viewed, access
// transmission_block_case). `getTransmissionCaseAddress` é chamado DIRETO (sem useQuery, sem setQueryData): o endereço fica só no
// estado deste componente, nunca no queryClient, em storage, em console ou na URL, e some ao fechar ou ao desmontar. Só em bloqueio
// proposed/active (quem monta confere); 409 invalid_transition (fechou no meio) → onStale, que diz a frase e relê UMA vez.
import { useEffect, useRef, useState } from "react";
import { getTransmissionCaseAddress, type CaseAddress } from "../../lib/api";
import { isVectorStale, vectorError } from "../../lib/vectorControl";
import { SensitiveAction } from "../../components/SensitiveAction";
import { secondaryButtonStyle } from "../../components/formStyles";
import { box, muted, row } from "../exams/styles";

export const ADDRESS_DESCRIPTION = "A leitura fica registrada na trilha. Use o endereço só para escolher o quarteirão.";
export const NO_PATIENT_ADDRESS = "sem endereço no cadastro do paciente";

export function CaseAddressDialog({ blockId, caseId, caseNumber, onClose, onStale, onGoToSecurity }: {
  blockId: string; caseId: string; caseNumber?: number; onClose?(): void; onStale?(err: unknown): void; onGoToSecurity?: () => void;
}) {
  const [ asking, setAsking ] = useState(false);
  const [ address, setAddress ] = useState<CaseAddress | null>(null);
  // A resposta passa por aqui só entre o run e o onDone do SensitiveAction; desmontado no meio, nada é guardado.
  const got = useRef<CaseAddress | null>(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; got.current = null; }; }, []);
  const name = caseNumber === undefined ? "Endereço do caso" : `Endereço do caso ${caseNumber}`;

  function close() {
    setAddress(null);
    got.current = null;
    onClose?.();
  }

  if (address) {
    return (
      <section role="dialog" aria-label={name} style={box}>
        <strong>{name}</strong>
        <p style={muted}>Endereço do paciente</p>
        <strong>{address.patient_address ?? NO_PATIENT_ADDRESS}</strong>
        {address.household_address && (
          <>
            <p style={muted}>Domicílio do cadastro individual</p>
            <strong>{address.household_address}</strong>
          </>
        )}
        <p style={muted}>{ADDRESS_DESCRIPTION}</p>
        <div style={row}><button type="button" style={secondaryButtonStyle} onClick={close}>Fechar</button></div>
      </section>
    );
  }
  if (!asking) {
    return <button type="button" style={secondaryButtonStyle} onClick={() => setAsking(true)}>Ver endereço do caso</button>;
  }
  return (
    <SensitiveAction
      title={name}
      description={ADDRESS_DESCRIPTION}
      requiresStepUp
      run={async () => {
        const result = await getTransmissionCaseAddress(blockId, caseId);
        if (alive.current) got.current = result;
      }}
      onDone={() => {
        const result = got.current;
        got.current = null;
        setAsking(false);
        if (result) setAddress(result);
      }}
      onCancel={() => { setAsking(false); onClose?.(); }}
      onGoToSecurity={onGoToSecurity}
      translateError={(e) => {
        if (isVectorStale(e)) { setAsking(false); onStale?.(e); }
        return vectorError(e);
      }}
    />
  );
}
