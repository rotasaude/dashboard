// Requisição de exames em PDF (módulo 19c; spec §4; contrato §3): o api monta
// a requisição com os exames pedidos na consulta (o que já está salvo); aqui
// só a observação (até 500 caracteres). Sem exames, o api recusa (no_exam_requests).
import { useRef, useState, type FormEvent } from "react";
import type { ExamRequisitionInput } from "../../lib/api";
import { documentError } from "../../lib/clinicalDocuments";
import { buttonStyle, disabledButtonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alertStyle, formBox, labelStyle, mutedStyle, rowStyle } from "./formStyles";

interface Props {
  initialNote?: string;
  onSubmit(content: ExamRequisitionInput): Promise<void>;
  onCancel(): void;
  busy?: boolean;
  replacing?: boolean;
}

export function ExamRequisitionForm({ initialNote = "", onSubmit, onCancel, busy: externalBusy = false, replacing }: Props) {
  const [ note, setNote ] = useState(initialNote);
  const [ ownBusy, setOwnBusy ] = useState(false);
  const inFlight = useRef(false);
  const [ problem, setProblem ] = useState<string | null>(null);
  const busy = ownBusy || externalBusy;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current || externalBusy) return;
    inFlight.current = true;
    setOwnBusy(true); setProblem(null);
    try {
      const trimmed = note.trim();
      await onSubmit(trimmed ? { note: trimmed } : {});
    } catch (err) {
      setProblem(documentError(err));
    } finally {
      inFlight.current = false;
      setOwnBusy(false);
    }
  }

  return (
    <form aria-label="Requisição de exames" onSubmit={(e) => void submit(e)} style={formBox}>
      <strong>Requisição de exames</strong>
      {replacing && <p style={mutedStyle}>Substitui o documento cancelado.</p>}
      <p style={mutedStyle}>
        A requisição sai com os exames pedidos na consulta (o que já está salvo). Para mudar a lista, edite a consulta — ou faça um
        adendo, se ela já foi finalizada.
      </p>
      <label style={labelStyle}>
        Observação (opcional)
        <textarea value={note} rows={2} maxLength={500} style={inputStyle} onChange={(e) => setNote(e.target.value)} />
      </label>
      {problem && <p role="alert" style={alertStyle}>{problem}</p>}
      <div style={rowStyle}>
        <button type="submit" disabled={busy} style={busy ? disabledButtonStyle : buttonStyle}>Emitir requisição</button>
        <button type="button" disabled={busy} style={secondaryButtonStyle} onClick={onCancel}>Cancelar</button>
      </div>
    </form>
  );
}
