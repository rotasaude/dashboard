// Declaração de comparecimento (módulo 19c; spec §4; contrato §2 e §3): o dia
// e o período, ou a hora de chegada (e a de saída). Usada na consulta (pela
// autora) e na recepção (pelo atendimento), onde o papel traz a matrícula de
// quem emite (`showIssuerRegistration`; o profissional emite com o próprio CBO
// e conselho, então a recepção a esconde dele). A unidade sai do atendimento.
import { useRef, useState, type FormEvent } from "react";
import type { DeclarationInput, DeclarationPeriod } from "../../lib/api";
import { PERIOD_LABEL, declarationInput, declarationProblem, documentError, type DeclarationDraft } from "../../lib/clinicalDocuments";
import { buttonStyle, disabledButtonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alertStyle, checkLabel, formBox, labelStyle, mutedStyle, rowStyle } from "./formStyles";

interface Props {
  initial: DeclarationDraft;
  showIssuerRegistration?: boolean;
  onSubmit(content: DeclarationInput): Promise<void>;
  onCancel(): void;
  busy?: boolean;
  replacing?: boolean;
}

export function DeclarationForm({ initial, showIssuerRegistration, onSubmit, onCancel, busy: externalBusy = false, replacing }: Props) {
  const [ d, setD ] = useState<DeclarationDraft>(initial);
  const [ ownBusy, setOwnBusy ] = useState(false);
  const inFlight = useRef(false);
  const [ problem, setProblem ] = useState<string | null>(null);
  const busy = ownBusy || externalBusy;
  const set = (patch: Partial<DeclarationDraft>) => setD((prev) => ({ ...prev, ...patch }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current || externalBusy) return;
    const found = declarationProblem(d);
    if (found) { setProblem(found); return; }
    inFlight.current = true;
    setOwnBusy(true); setProblem(null);
    try {
      await onSubmit(declarationInput(d));
    } catch (err) {
      setProblem(documentError(err));
    } finally {
      inFlight.current = false;
      setOwnBusy(false);
    }
  }

  return (
    <form aria-label="Declaração de comparecimento" onSubmit={(e) => void submit(e)} style={formBox}>
      <strong>Declaração de comparecimento</strong>
      {replacing && <p style={mutedStyle}>Substitui o documento cancelado.</p>}
      <p style={mutedStyle}>O dia é o do atendimento; a unidade também (o api preenche os dois).</p>
      <div role="radiogroup" aria-label="como informar" style={rowStyle}>
        <label style={checkLabel}>
          <input type="radio" name="declaration-mode" checked={d.mode === "period"} onChange={() => set({ mode: "period" })} />
          Por período
        </label>
        <label style={checkLabel}>
          <input type="radio" name="declaration-mode" checked={d.mode === "times"} onChange={() => set({ mode: "times" })} />
          Por horário
        </label>
      </div>
      {d.mode === "period" ? (
        <label style={labelStyle}>
          Período
          <select value={d.period} style={inputStyle} onChange={(e) => set({ period: e.target.value as DeclarationPeriod | "" })}>
            <option value="">escolha</option>
            {(Object.keys(PERIOD_LABEL) as DeclarationPeriod[]).map((p) => <option key={p} value={p}>{PERIOD_LABEL[p]}</option>)}
          </select>
        </label>
      ) : (
        <div style={rowStyle}>
          <label style={labelStyle}>
            Chegada
            <input type="time" value={d.arrivedAt} style={inputStyle} onChange={(e) => set({ arrivedAt: e.target.value })} />
          </label>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={labelStyle}>
              Saída
              <input type="time" value={d.leftAt} style={inputStyle} onChange={(e) => set({ leftAt: e.target.value })} />
            </label>
            <span style={mutedStyle}>em branco, sai a hora de encerramento do atendimento (se for no mesmo dia)</span>
          </div>
        </div>
      )}
      <label style={labelStyle}>
        Acompanhante (opcional)
        <input value={d.companionName} style={inputStyle} onChange={(e) => set({ companionName: e.target.value })} />
      </label>
      {showIssuerRegistration && (
        <label style={labelStyle}>
          Sua matrícula (sai no papel)
          <input value={d.issuerRegistration} maxLength={30} style={inputStyle} onChange={(e) => set({ issuerRegistration: e.target.value })} />
        </label>
      )}
      {problem && <p role="alert" style={alertStyle}>{problem}</p>}
      <div style={rowStyle}>
        <button type="submit" disabled={busy} style={busy ? disabledButtonStyle : buttonStyle}>Emitir declaração</button>
        <button type="button" disabled={busy} style={secondaryButtonStyle} onClick={onCancel}>Cancelar</button>
      </div>
    </form>
  );
}
