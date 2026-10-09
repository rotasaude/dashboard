// src/modules/clinicalRecord/OpeningForm.tsx
// Pedido de abertura justificada (módulo 19; spec §5 e §7). O step-up usa o
// padrão existente (SensitiveAction): a tela diz o quê, ele pede o código.
import { useRef, useState, type CSSProperties } from "react";
import { errorCode, openClinicalRecord, type Opening, type OpeningReason } from "../../lib/api";
import { maskCpf } from "../../lib/attendance";
import {
  EMPTY_OPENING, OPENING_REASONS, clinicalRecordError, openingBody, openingProblem, reasonLabel, type OpeningDraft
} from "../../lib/clinicalRecord";
import { Panel } from "../../components/Panel";
import { SensitiveAction } from "../../components/SensitiveAction";
import { FrozenTextNotice } from "../../components/FrozenTextNotice";
import { buttonStyle, inputStyle } from "../../components/formStyles";

const OWN_REFUSALS = new Set([ "patient_not_found", "invalid_reason", "feature_disabled", "missing_role" ]);

export function OpeningForm({ onOpened, onGoToSecurity }: { onOpened(o: Opening): void; onGoToSecurity?(): void }) {
  const [ draft, setDraft ] = useState<OpeningDraft>(EMPTY_OPENING);
  const [ problem, setProblem ] = useState<string | null>(null);
  const [ confirming, setConfirming ] = useState(false);
  const opened = useRef<Opening | null>(null);

  function next() {
    const p = openingProblem(draft);
    setProblem(p);
    if (!p) setConfirming(true);
  }

  return (
    <Panel title="Abrir prontuário fora do atendimento" sub="abertura justificada · válida por 30 minutos">
      <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 420 }}>
        <p style={muted}>
          Use só quando precisar ler o prontuário de alguém que não está em atendimento com você. A abertura fica
          registrada, com o motivo, e aparece no relatório da administração.
        </p>
        {!confirming ? (
          <>
            <label style={labelStyle}>
              CPF do paciente
              <input value={draft.cpf} inputMode="numeric" style={inputStyle}
                onChange={(e) => setDraft({ ...draft, cpf: maskCpf(e.target.value) })} />
            </label>
            <label style={labelStyle}>
              Motivo
              <select value={draft.reason} style={inputStyle}
                onChange={(e) => setDraft({ ...draft, reason: e.target.value as OpeningReason | "" })}>
                <option value="">—</option>
                {OPENING_REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </label>
            <label style={labelStyle}>
              Descrição do motivo
              <textarea value={draft.note} rows={2} style={inputStyle} aria-describedby="opening-note-notice"
                onChange={(e) => setDraft({ ...draft, note: e.target.value })} />
            </label>
            <FrozenTextNotice id="opening-note-notice" />
            <small style={muted}>Obrigatória em "Outro motivo" (pelo menos 10 caracteres).</small>
            {problem && <p role="alert" style={alert}>{problem}</p>}
            <div><button type="button" style={buttonStyle} onClick={next}>Continuar</button></div>
          </>
        ) : (
          <SensitiveAction
            title="Confirmar abertura justificada"
            description={`CPF ${draft.cpf} · ${reasonLabel(draft.reason)}. A leitura vale por 30 minutos e fica no relatório da administração.`}
            requiresStepUp
            confirmLabel="Abrir prontuário"
            run={async () => { opened.current = await openClinicalRecord(openingBody(draft)); }}
            onDone={() => { if (opened.current) onOpened(opened.current); }}
            onCancel={() => setConfirming(false)}
            onGoToSecurity={onGoToSecurity}
            translateError={(err) => (OWN_REFUSALS.has(errorCode(err) ?? "") ? clinicalRecordError(err) : null)}
          />
        )}
      </div>
    </Panel>
  );
}

const labelStyle: CSSProperties = { display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--ink2)" };
const muted: CSSProperties = { margin: 0, fontSize: 12, color: "var(--ink3)" };
const alert: CSSProperties = { margin: 0, fontSize: 12.5, color: "var(--down)" };
